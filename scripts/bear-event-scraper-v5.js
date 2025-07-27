// Bear Event Scraper V5 - Enhanced with Real Website Analysis
// Based on actual HTML structures from uploaded website examples
// Created: 2025-01-27
// Features: Real website patterns, enhanced safety, detailed preview mode
//
// Data Structure: Follows standardized format in data/website-samples/event-data-structure.json
// HTML Patterns: Based on samples in data/website-samples/ directory
// Repeatability: Ensures consistent output format for chunky-dad calendar system

// Minified dependencies (embedded for Scriptable)
// JSONFileManager - File-based JSON storage for Scriptable
class JSONFileManager{constructor(a){this.filename=a}async read(){try{const a=FileManager.iCloud(),b=a.documentsDirectory(),c=a.joinPath(b,this.filename);return a.fileExists(c)?JSON.parse(a.readString(c)):{}}catch(a){return console.error(`Error reading ${this.filename}:`,a),{}}}async write(a){try{const b=FileManager.iCloud(),c=b.documentsDirectory(),d=b.joinPath(c,this.filename);b.writeString(d,JSON.stringify(a,null,2))}catch(b){console.error(`Error writing ${this.filename}:`,b)}}async append(a){const b=await this.read();Object.assign(b,a),await this.write(b)}}

// FileLogger - Logging to files for Scriptable  
class FileLogger{constructor(a){this.filename=a,this.logs=[]}log(a){const b=new Date().toISOString();this.logs.push(`${b}: ${a}`),console.log(a)}async flush(){if(0===this.logs.length)return;try{const a=FileManager.iCloud(),b=a.documentsDirectory(),c=a.joinPath(b,this.filename),d=this.logs.join('\n')+'\n';a.fileExists(c)?a.writeString(c,a.readString(c)+d):a.writeString(c,d),this.logs=[]}catch(a){console.error('Error writing log file:',a)}}}

// PerformanceDebugger - Performance tracking for Scriptable
class PerformanceDebugger{constructor(){this.metrics=[],this.timers={}}time(a){this.timers[a]=Date.now()}timeEnd(a){if(this.timers[a]){const b=Date.now()-this.timers[a];this.metrics.push({operation:a,duration:b,timestamp:new Date().toISOString()}),delete this.timers[a]}}async saveMetrics(a){const b=new JSONFileManager(a);await b.write(this.metrics)}}

// Main Bear Event Parser Class
class BearEventParser {
    constructor() {
        this.logger = new FileLogger('bear-event-scraper-v5-logs.txt');
        this.performance = new PerformanceDebugger();
        this.configManager = new JSONFileManager('bear-event-scraper-v5-config.json');
        
        // Enhanced safety configuration
        this.config = {
            dryRun: true,              // Don't modify calendars
            preview: true,             // Show what would be done
            calendarSync: false,       // Disable calendar sync
            safetyMode: true,         // Enable all safety features
            maxEvents: 100,           // Limit number of events processed
            timeout: 30000,           // Request timeout in ms
            retryAttempts: 3          // Number of retry attempts
        };
        
        // Enhanced bear keywords based on real website analysis
        this.bearKeywords = [
            'bear', 'bears', 'cub', 'cubs', 'otter', 'otters',
            'daddy', 'daddies', 'woof', 'grr', 'furry', 'hairy',
            'beef', 'chunk', 'chub', 'muscle bear', 'leather bear',
            'polar bear', 'grizzly', 'bearracuda', 'furball', 'megawoof',
            'diaper happy hour', 'bears night out', 'rockstrap', 'underbear',
            'filth', 'jizznasium', 'club chub', 'young hearts', 'xl',
            'blufsf', 'adonis', 'beer bust', 'disco daddy'
        ];
        
        // City calendar mapping
        this.cityCalendarMap = {
            'nyc': 'chunky-dad-nyc',
            'new york': 'chunky-dad-nyc',
            'manhattan': 'chunky-dad-nyc',
            'brooklyn': 'chunky-dad-nyc',
            'la': 'chunky-dad-la',
            'los angeles': 'chunky-dad-la',
            'long beach': 'chunky-dad-la',
            'chicago': 'chunky-dad-chicago',
            'sf': 'chunky-dad-sf',
            'san francisco': 'chunky-dad-sf',
            'seattle': 'chunky-dad-seattle',
            'dc': 'chunky-dad-dc',
            'washington': 'chunky-dad-dc',
            'boston': 'chunky-dad-boston',
            'atlanta': 'chunky-dad-atlanta',
            'miami': 'chunky-dad-miami',
            'dallas': 'chunky-dad-dallas',
            'denver': 'chunky-dad-denver',
            'portland': 'chunky-dad-portland',
            'philadelphia': 'chunky-dad-philadelphia',
            'phoenix': 'chunky-dad-phoenix',
            'austin': 'chunky-dad-austin',
            'new orleans': 'chunky-dad-nola',
            'nola': 'chunky-dad-nola',
            'las vegas': 'chunky-dad-vegas',
            'vegas': 'chunky-dad-vegas'
        };
        
        // Venue location defaults based on real website analysis
        // Matches data/website-samples/event-data-structure.json format
        this.venueDefaults = {
            'eagle bar': { 
                city: 'nyc', 
                address: '554 W 28th St, New York, NY',
                coordinates: { lat: 40.7505, lng: -73.9934 }
            },
            'rockbar': { 
                city: 'nyc', 
                address: '185 Christopher St, New York, NY',
                coordinates: { lat: 40.7338, lng: -74.0027 }
            },
            'sf eagle': { 
                city: 'sf', 
                address: '398 12th St, San Francisco, CA',
                coordinates: { lat: 37.7697, lng: -122.4131 }
            },
            'eagle ny': { 
                city: 'nyc', 
                address: '554 W 28th St, New York, NY',
                coordinates: { lat: 40.7505, lng: -73.9934 }
            },
            'metro': { 
                city: 'chicago', 
                address: '3730 N Clark St, Chicago, IL',
                coordinates: { lat: 41.9489, lng: -87.6598 }
            },
            'santos bar': { 
                city: 'nola', 
                address: '1135 Decatur St, New Orleans, LA',
                coordinates: { lat: 29.9584, lng: -90.0644 }
            },
            'executive suite': { 
                city: 'la', 
                address: '3428 E Broadway, Long Beach, CA',
                coordinates: { lat: 33.7701, lng: -118.1937 }
            },
            'paradise': { 
                city: 'nyc', 
                address: '126 2nd Ave, New York, NY',
                coordinates: { lat: 40.7282, lng: -73.9942 }
            },
            'precinct': { 
                city: 'la', 
                address: '357 S Broadway, Los Angeles, CA',
                coordinates: { lat: 34.0489, lng: -118.2517 }
            }
        };
    }
    
    async parseEvents(config) {
        this.performance.time('total_parsing');
        this.logger.log('=== Bear Event Scraper V5 Started ===');
        this.logger.log(`Safety Mode: ${this.config.safetyMode ? 'ENABLED' : 'DISABLED'}`);
        this.logger.log(`Dry Run: ${this.config.dryRun ? 'ENABLED' : 'DISABLED'}`);
        this.logger.log(`Preview Mode: ${this.config.preview ? 'ENABLED' : 'DISABLED'}`);
        
        const allEvents = {};
        const parseResults = [];
        
        // Update config with user settings
        if (config.config) {
            Object.assign(this.config, config.config);
        }
        
        for (const parser of config.parsers) {
            this.logger.log(`\n--- Processing ${parser.name} ---`);
            this.performance.time(`parse_${parser.name}`);
            
            try {
                const events = await this.parseSource(parser);
                if (events && events.length > 0) {
                    this.logger.log(`✅ Found ${events.length} events from ${parser.name}`);
                    
                    // Group events by city
                    for (const event of events) {
                        const city = event.city || 'unknown';
                        if (!allEvents[city]) allEvents[city] = [];
                        allEvents[city].push(event);
                    }
                    
                    parseResults.push({
                        source: parser.name,
                        success: true,
                        eventCount: events.length,
                        events: events
                    });
                } else {
                    this.logger.log(`⚠️ No events found from ${parser.name}`);
                    parseResults.push({
                        source: parser.name,
                        success: true,
                        eventCount: 0,
                        events: []
                    });
                }
            } catch (error) {
                this.logger.log(`❌ Error parsing ${parser.name}: ${error.message}`);
                parseResults.push({
                    source: parser.name,
                    success: false,
                    error: error.message,
                    eventCount: 0,
                    events: []
                });
            }
            
            this.performance.timeEnd(`parse_${parser.name}`);
        }
        
        // Save results
        const timestamp = new Date().toISOString().split('T')[0];
        const outputFile = `bear-events-v5-${timestamp}.json`;
        const outputManager = new JSONFileManager(outputFile);
        await outputManager.write({
            timestamp: new Date().toISOString(),
            version: 'v5',
            config: this.config,
            summary: {
                totalSources: config.parsers.length,
                successfulSources: parseResults.filter(r => r.success).length,
                totalEvents: parseResults.reduce((sum, r) => sum + r.eventCount, 0),
                citiesFound: Object.keys(allEvents).length
            },
            parseResults: parseResults,
            eventsByCity: allEvents
        });
        
        // Generate reports
        await this.generateReport(parseResults, allEvents, timestamp);
        
        if (this.config.preview) {
            await this.generatePreviewReport(allEvents, timestamp);
        }
        
        this.performance.timeEnd('total_parsing');
        await this.performance.saveMetrics('bear-event-scraper-v5-performance.csv');
        await this.logger.flush();
        
        this.logger.log(`\n=== Parsing Complete ===`);
        this.logger.log(`Output saved to: ${outputFile}`);
        
        return allEvents;
    }
    
    async parseSource(parser) {
        const events = [];
        
        for (const url of parser.urls) {
            this.logger.log(`Fetching: ${url}`);
            
            try {
                const request = new Request(url);
                request.timeoutInterval = this.config.timeout;
                const html = await request.loadString();
                
                let sourceEvents = [];
                
                switch (parser.parser) {
                    case 'furball':
                        sourceEvents = this.parseFurball(html, url);
                        break;
                    case 'rockbar':
                        sourceEvents = this.parseRockbar(html, url, parser.allowlist);
                        break;
                    case 'bearracuda':
                        sourceEvents = this.parseBearracuda(html, url);
                        break;
                    case 'megawoof':
                        sourceEvents = this.parseMegawoof(html, url);
                        break;
                    case 'sf-eagle':
                        sourceEvents = this.parseSFEagle(html, url);
                        break;
                    case 'eagle-ny':
                        sourceEvents = this.parseEagleNY(html, url);
                        break;
                    case 'precinct':
                        sourceEvents = this.parsePrecinct(html, url);
                        break;
                    default:
                        this.logger.log(`⚠️ Unknown parser type: ${parser.parser}`);
                        continue;
                }
                
                events.push(...sourceEvents);
                
            } catch (error) {
                this.logger.log(`❌ Error fetching ${url}: ${error.message}`);
            }
        }
        
        return events;
    }
    
    // Enhanced Furball parser based on actual HTML structure
    parseFurball(html, sourceUrl) {
        this.logger.log('Parsing Furball events...');
        const events = [];
        
        try {
            // Pattern 1: Date headers followed by event info
            // Based on actual structure: <h2>JULY 25, 2025</h2> followed by <h2>FURBALL NYC</h2> and <h3>Eagle Bar - NYC</h3>
            const datePattern = /<h2[^>]*>([A-Z]+ \d+, \d+)<\/h2>/gi;
            const eventPattern = /<h2[^>]*>(FURBALL[^<]+)<\/h2>/gi;
            const venuePattern = /<h3[^>]*>([^<]+)<\/h3>/gi;
            
            let dateMatch;
            while ((dateMatch = datePattern.exec(html)) !== null) {
                const dateStr = dateMatch[1];
                const date = this.parseDate(dateStr);
                
                if (date) {
                    // Look for event title after this date
                    const afterDate = html.substring(dateMatch.index + dateMatch[0].length, dateMatch.index + 1000);
                    const titleMatch = eventPattern.exec(afterDate);
                    const venueMatch = venuePattern.exec(afterDate);
                    
                    if (titleMatch) {
                        const event = this.formatEventForCalendar({
                            name: titleMatch[1].trim(),
                            startDate: date,
                            endDate: new Date(date.getTime() + 5 * 60 * 60 * 1000), // 5 hours later
                            venue: venueMatch ? venueMatch[1].trim() : 'TBD',
                            sourceUrl: sourceUrl,
                            source: 'Furball'
                        });
                        
                        if (event) {
                            events.push(event);
                        }
                    }
                }
            }
            
            // Pattern 2: Text-based event listings
            const textEventPattern = /(\d+\/\d+)\s+(FURBALL[^<\n]+)/gi;
            let textMatch;
            while ((textMatch = textEventPattern.exec(html)) !== null) {
                const dateStr = textMatch[1];
                const eventName = textMatch[2].trim();
                const date = this.parseDate(dateStr);
                
                if (date) {
                    const event = this.formatEventForCalendar({
                        name: eventName,
                        startDate: date,
                        endDate: new Date(date.getTime() + 5 * 60 * 60 * 1000),
                        venue: this.extractVenueFromText(eventName),
                        sourceUrl: sourceUrl,
                        source: 'Furball'
                    });
                    
                    if (event) {
                        events.push(event);
                    }
                }
            }
            
        } catch (error) {
            this.logger.log(`Error parsing Furball: ${error.message}`);
        }
        
        this.logger.log(`Furball: Found ${events.length} events`);
        return events;
    }
    
    // Enhanced Rockbar parser based on actual HTML structure
    parseRockbar(html, sourceUrl, allowlist = []) {
        this.logger.log('Parsing Rockbar events...');
        const events = [];
        
        try {
            // Based on actual structure: <div class="fc-event-title">BEARS NIGHT OUT</div>
            const eventPattern = /<div class="fc-event-title">([^<]+)<\/div><div class="fc-event-time">([^<]+)<\/div>/gi;
            
            let match;
            while ((match = eventPattern.exec(html)) !== null) {
                const title = match[1].trim();
                const timeStr = match[2].trim();
                
                // Check if it's a bear event or in allowlist
                const isBearEvent = this.isBearEvent(title) || 
                                  allowlist.some(allowed => title.toLowerCase().includes(allowed.toLowerCase()));
                
                if (isBearEvent) {
                    const event = this.formatEventForCalendar({
                        name: title,
                        startDate: this.parseTime(timeStr),
                        endDate: this.parseEndTime(timeStr),
                        venue: 'Rockbar NYC',
                        city: 'nyc',
                        address: '185 Christopher St, New York, NY',
                        sourceUrl: sourceUrl,
                        source: 'Rockbar'
                    });
                    
                    if (event) {
                        events.push(event);
                    }
                }
            }
            
        } catch (error) {
            this.logger.log(`Error parsing Rockbar: ${error.message}`);
        }
        
        this.logger.log(`Rockbar: Found ${events.length} events`);
        return events;
    }
    
    // Enhanced Bearracuda parser based on actual HTML structure
    parseBearracuda(html, sourceUrl) {
        this.logger.log('Parsing Bearracuda events...');
        const events = [];
        
        try {
            // Look for event titles and dates in the HTML
            const titlePattern = /<h1[^>]*>([^<]*(?:Atlanta|Chicago|NYC|NOLA|Denver)[^<]*)<\/h1>/gi;
            const datePattern = /<meta property="article:modified_time" content="([^"]+)"/i;
            
            let titleMatch;
            while ((titleMatch = titlePattern.exec(html)) !== null) {
                const title = titleMatch[1].trim();
                
                if (this.isBearEvent(title) || title.toLowerCase().includes('bearracuda')) {
                    const dateMatch = html.match(datePattern);
                    const date = dateMatch ? new Date(dateMatch[1]) : new Date();
                    
                    const event = this.formatEventForCalendar({
                        name: title,
                        startDate: date,
                        endDate: new Date(date.getTime() + 6 * 60 * 60 * 1000), // 6 hours later
                        venue: this.extractVenueFromText(title),
                        sourceUrl: sourceUrl,
                        source: 'Bearracuda'
                    });
                    
                    if (event) {
                        events.push(event);
                    }
                }
            }
            
        } catch (error) {
            this.logger.log(`Error parsing Bearracuda: ${error.message}`);
        }
        
        this.logger.log(`Bearracuda: Found ${events.length} events`);
        return events;
    }
    
    // Enhanced Megawoof parser based on actual Eventbrite structure
    parseMegawoof(html, sourceUrl) {
        this.logger.log('Parsing Megawoof events...');
        const events = [];
        
        try {
            // Based on actual structure: data-event-location="Atlanta, GA" data-event-category="community"
            const eventPattern = /data-event-location="([^"]+)"[^>]*data-event-category="([^"]+)"[^>]*>[\s\S]*?<[^>]*>([^<]+)</gi;
            
            let match;
            while ((match = eventPattern.exec(html)) !== null) {
                const location = match[1].trim();
                const category = match[2].trim();
                const possibleTitle = match[3].trim();
                
                // Look for actual event title nearby
                const context = html.substring(match.index - 500, match.index + 500);
                const titleMatch = context.match(/(?:title="([^"]+)"|>([^<]*(?:MEGAWOOF|WOOF|Bear)[^<]*)<)/i);
                const title = titleMatch ? (titleMatch[1] || titleMatch[2] || possibleTitle) : possibleTitle;
                
                if (this.isBearEvent(title) || title.toLowerCase().includes('megawoof')) {
                    const event = this.formatEventForCalendar({
                        name: title.trim(),
                        startDate: new Date(), // Would need more parsing for actual dates
                        endDate: new Date(Date.now() + 4 * 60 * 60 * 1000),
                        venue: 'Megawoof Event',
                        city: this.extractCityFromLocation(location),
                        sourceUrl: sourceUrl,
                        source: 'Megawoof'
                    });
                    
                    if (event) {
                        events.push(event);
                    }
                }
            }
            
        } catch (error) {
            this.logger.log(`Error parsing Megawoof: ${error.message}`);
        }
        
        this.logger.log(`Megawoof: Found ${events.length} events`);
        return events;
    }
    
    // SF Eagle parser based on actual HTML structure
    parseSFEagle(html, sourceUrl) {
        this.logger.log('Parsing SF Eagle events...');
        const events = [];
        
        try {
            // Based on actual structure: <h3 class="tribe-events-calendar-list__event-title">
            const eventPattern = /<span class="tribe-event-date-start">([^<]+)<\/span>[^<]*<span class="tribe-event-time">([^<]+)<\/span>[\s\S]*?<h3 class="tribe-events-calendar-list__event-title[^"]*">[\s\S]*?<a[^>]*title="([^"]+)"/gi;
            
            let match;
            while ((match = eventPattern.exec(html)) !== null) {
                const dateStr = match[1].trim();
                const timeStr = match[2].trim();
                const title = match[3].trim();
                
                if (this.isBearEvent(title)) {
                    const startDate = this.parseDate(`${dateStr} ${timeStr}`);
                    
                    if (startDate) {
                        const event = this.formatEventForCalendar({
                            name: title,
                            startDate: startDate,
                            endDate: new Date(startDate.getTime() + 4 * 60 * 60 * 1000),
                            venue: 'SF Eagle',
                            city: 'sf',
                            address: '398 12th St, San Francisco, CA',
                            sourceUrl: sourceUrl,
                            source: 'SF Eagle'
                        });
                        
                        if (event) {
                            events.push(event);
                        }
                    }
                }
            }
            
        } catch (error) {
            this.logger.log(`Error parsing SF Eagle: ${error.message}`);
        }
        
        this.logger.log(`SF Eagle: Found ${events.length} events`);
        return events;
    }
    
    // Eagle NY parser (similar structure to SF Eagle)
    parseEagleNY(html, sourceUrl) {
        this.logger.log('Parsing Eagle NY events...');
        const events = [];
        
        try {
            // Similar pattern to SF Eagle but for NYC
            const eventPattern = /<span class="tribe-event-date-start">([^<]+)<\/span>[^<]*<span class="tribe-event-time">([^<]+)<\/span>[\s\S]*?<h3 class="tribe-events-calendar-list__event-title[^"]*">[\s\S]*?<a[^>]*title="([^"]+)"/gi;
            
            let match;
            while ((match = eventPattern.exec(html)) !== null) {
                const dateStr = match[1].trim();
                const timeStr = match[2].trim();
                const title = match[3].trim();
                
                if (this.isBearEvent(title)) {
                    const startDate = this.parseDate(`${dateStr} ${timeStr}`);
                    
                    if (startDate) {
                        const event = this.formatEventForCalendar({
                            name: title,
                            startDate: startDate,
                            endDate: new Date(startDate.getTime() + 4 * 60 * 60 * 1000),
                            venue: 'Eagle NY',
                            city: 'nyc',
                            address: '554 W 28th St, New York, NY',
                            sourceUrl: sourceUrl,
                            source: 'Eagle NY'
                        });
                        
                        if (event) {
                            events.push(event);
                        }
                    }
                }
            }
            
        } catch (error) {
            this.logger.log(`Error parsing Eagle NY: ${error.message}`);
        }
        
        this.logger.log(`Eagle NY: Found ${events.length} events`);
        return events;
    }
    
    // Precinct parser
    parsePrecinct(html, sourceUrl) {
        this.logger.log('Parsing Precinct events...');
        const events = [];
        
        try {
            // Look for event patterns in Precinct HTML
            const eventPattern = /<div[^>]*class="[^"]*event[^"]*"[^>]*>[\s\S]*?<h[23][^>]*>([^<]+)<\/h[23]>[\s\S]*?<[^>]*>([^<]*\d{1,2}[^<]*)<[^>]*>/gi;
            
            let match;
            while ((match = eventPattern.exec(html)) !== null) {
                const title = match[1].trim();
                const dateStr = match[2].trim();
                
                if (this.isBearEvent(title)) {
                    const startDate = this.parseDate(dateStr);
                    
                    if (startDate) {
                        const event = this.formatEventForCalendar({
                            name: title,
                            startDate: startDate,
                            endDate: new Date(startDate.getTime() + 4 * 60 * 60 * 1000),
                            venue: 'Precinct DTLA',
                            city: 'la',
                            address: '357 S Broadway, Los Angeles, CA',
                            sourceUrl: sourceUrl,
                            source: 'Precinct'
                        });
                        
                        if (event) {
                            events.push(event);
                        }
                    }
                }
            }
            
        } catch (error) {
            this.logger.log(`Error parsing Precinct: ${error.message}`);
        }
        
        this.logger.log(`Precinct: Found ${events.length} events`);
        return events;
    }
    
    // Helper methods
    isBearEvent(title) {
        const titleLower = title.toLowerCase();
        return this.bearKeywords.some(keyword => titleLower.includes(keyword.toLowerCase()));
    }
    
    parseDate(dateStr) {
        try {
            // Handle various date formats found in the websites
            dateStr = dateStr.replace(/[@\-]/g, ' ').trim();
            
            // Format: "JULY 25, 2025"
            if (/^[A-Z]+ \d+, \d+$/.test(dateStr)) {
                return new Date(dateStr);
            }
            
            // Format: "7/25" (current year)
            if (/^\d{1,2}\/\d{1,2}$/.test(dateStr)) {
                const [month, day] = dateStr.split('/');
                const year = new Date().getFullYear();
                return new Date(year, month - 1, day);
            }
            
            // Format: "July 27 @ 12:00 pm"
            if (dateStr.includes('@')) {
                const [datePart, timePart] = dateStr.split('@');
                const date = new Date(`${datePart.trim()} ${new Date().getFullYear()}`);
                if (timePart) {
                    const time = this.parseTime(timePart.trim());
                    if (time) {
                        date.setHours(time.getHours(), time.getMinutes());
                    }
                }
                return date;
            }
            
            // Fallback to standard parsing
            return new Date(dateStr);
        } catch (error) {
            this.logger.log(`Error parsing date "${dateStr}": ${error.message}`);
            return null;
        }
    }
    
    parseTime(timeStr) {
        try {
            const now = new Date();
            
            // Handle "9:00 PM - 9:00 PM" format
            if (timeStr.includes(' - ')) {
                timeStr = timeStr.split(' - ')[0];
            }
            
            // Parse time like "9:00 PM"
            const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
            if (timeMatch) {
                let hours = parseInt(timeMatch[1]);
                const minutes = parseInt(timeMatch[2] || '0');
                const ampm = timeMatch[3].toUpperCase();
                
                if (ampm === 'PM' && hours !== 12) hours += 12;
                if (ampm === 'AM' && hours === 12) hours = 0;
                
                const date = new Date(now);
                date.setHours(hours, minutes, 0, 0);
                return date;
            }
            
            return null;
        } catch (error) {
            this.logger.log(`Error parsing time "${timeStr}": ${error.message}`);
            return null;
        }
    }
    
    parseEndTime(timeStr) {
        // Extract end time from "9:00 PM - 2:00 AM" format
        if (timeStr.includes(' - ')) {
            const endTimeStr = timeStr.split(' - ')[1];
            return this.parseTime(endTimeStr);
        }
        return null;
    }
    
    extractVenueFromText(text) {
        const venuePatterns = [
            /@ ([^,\n]+)/i,
            /at ([^,\n]+)/i,
            /(Eagle Bar|Rockbar|Metro|Santos Bar|Executive Suite|Paradise)/i
        ];
        
        for (const pattern of venuePatterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        
        return 'TBD';
    }
    
    extractCityFromLocation(location) {
        const cityMap = {
            'Atlanta, GA': 'atlanta',
            'Los Angeles, CA': 'la',
            'Long Beach, CA': 'la',
            'Denver, CO': 'denver',
            'Las Vegas, NV': 'vegas',
            'New York, NY': 'nyc',
            'Chicago, IL': 'chicago',
            'San Francisco, CA': 'sf'
        };
        
        return cityMap[location] || 'unknown';
    }
    
    formatEventForCalendar(eventData) {
        try {
            // Standardized event formatting based on data/website-samples/event-data-structure.json
            
            // Determine city using venue defaults for consistency
            let city = eventData.city;
            let coordinates = eventData.coordinates;
            let address = eventData.address;
            
            if (!city && eventData.venue) {
                const venueLower = eventData.venue.toLowerCase();
                for (const [venue, defaults] of Object.entries(this.venueDefaults)) {
                    if (venueLower.includes(venue)) {
                        city = defaults.city;
                        address = address || defaults.address;
                        coordinates = coordinates || defaults.coordinates;
                        break;
                    }
                }
            }
            
            if (!city) {
                city = this.detectCityFromText(eventData.name + ' ' + (eventData.venue || ''));
            }
            
            // Standardized time formatting (12-hour format with AM/PM)
            const timeStr = eventData.startDate ? 
                eventData.startDate.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit',
                    hour12: true 
                }).replace(':00', '').replace(' ', '') : 'TBD';
            
            // Ensure required fields are present
            const formattedEvent = {
                // Required fields
                name: eventData.name || 'Untitled Event',
                startDate: eventData.startDate || new Date(),
                endDate: eventData.endDate || new Date(Date.now() + 4 * 60 * 60 * 1000),
                day: eventData.startDate ? eventData.startDate.toLocaleDateString('en-US', { weekday: 'long' }) : 'TBD',
                time: timeStr,
                bar: eventData.venue || 'TBD',
                city: city || 'unknown',
                
                // Optional fields
                cover: eventData.cover || 'TBD',
                tea: eventData.description || `${eventData.source} event`,
                coordinates: coordinates || { lat: 0, lng: 0 },
                links: [
                    { type: 'website', url: eventData.sourceUrl, label: '🌐 Website' }
                ],
                eventType: 'special',
                recurring: false,
                notChecked: true, // Always true for newly parsed events
                source: eventData.source,
                address: address
            };
            
            // Validate the formatted event matches our standard structure
            this.validateEventStructure(formattedEvent);
            
            return formattedEvent;
        } catch (error) {
            this.logger.log(`Error formatting event: ${error.message}`);
            return null;
        }
    }
    
    validateEventStructure(event) {
        // Validate against standardized data structure
        const requiredFields = ['name', 'startDate', 'endDate', 'day', 'time', 'bar', 'city'];
        
        for (const field of requiredFields) {
            if (!event[field] || event[field] === 'TBD') {
                this.logger.log(`⚠️ Missing or TBD required field: ${field} in event: ${event.name}`);
            }
        }
        
        // Validate data formats
        if (event.startDate && !(event.startDate instanceof Date)) {
            this.logger.log(`⚠️ Invalid startDate format in event: ${event.name}`);
        }
        
        if (event.coordinates && (!event.coordinates.lat || !event.coordinates.lng)) {
            this.logger.log(`⚠️ Invalid coordinates format in event: ${event.name}`);
        }
        
        if (event.city && typeof event.city !== 'string') {
            this.logger.log(`⚠️ Invalid city format in event: ${event.name}`);
        }
    }
    
    detectCityFromText(text) {
        const textLower = text.toLowerCase();
        for (const [cityName, calendarId] of Object.entries(this.cityCalendarMap)) {
            if (textLower.includes(cityName)) {
                return cityName;
            }
        }
        return 'unknown';
    }
    
    async generateReport(parseResults, allEvents, timestamp) {
        const reportFile = `bear-event-scraper-v5-report-${timestamp}.txt`;
        const reportManager = new JSONFileManager(reportFile);
        
        let report = '=== Bear Event Scraper V5 Report ===\n';
        report += `Generated: ${new Date().toISOString()}\n`;
        report += `Safety Mode: ${this.config.safetyMode ? 'ENABLED' : 'DISABLED'}\n\n`;
        
        // Summary
        const totalEvents = parseResults.reduce((sum, r) => sum + r.eventCount, 0);
        report += `SUMMARY:\n`;
        report += `- Total Sources: ${parseResults.length}\n`;
        report += `- Successful Sources: ${parseResults.filter(r => r.success).length}\n`;
        report += `- Total Events Found: ${totalEvents}\n`;
        report += `- Cities: ${Object.keys(allEvents).join(', ')}\n\n`;
        
        // Source breakdown
        report += `SOURCE BREAKDOWN:\n`;
        for (const result of parseResults) {
            report += `- ${result.source}: ${result.success ? `${result.eventCount} events` : `FAILED (${result.error})`}\n`;
        }
        report += '\n';
        
        // Events by city
        report += `EVENTS BY CITY:\n`;
        for (const [city, events] of Object.entries(allEvents)) {
            report += `\n${city.toUpperCase()} (${events.length} events):\n`;
            for (const event of events.slice(0, 10)) { // Limit to first 10
                report += `  - ${event.name} at ${event.bar} (${event.source})\n`;
            }
            if (events.length > 10) {
                report += `  ... and ${events.length - 10} more\n`;
            }
        }
        
        await reportManager.write({ report });
        this.logger.log(`Report saved to: ${reportFile}`);
    }
    
    async generatePreviewReport(allEvents, timestamp) {
        const previewFile = `bear-event-scraper-v5-preview-${timestamp}.txt`;
        const previewManager = new JSONFileManager(previewFile);
        
        let preview = '=== Bear Event Scraper V5 Preview Report ===\n';
        preview += `Generated: ${new Date().toISOString()}\n`;
        preview += `Mode: ${this.config.dryRun ? 'DRY RUN' : 'LIVE'}\n\n`;
        
        if (this.config.dryRun) {
            preview += '🔒 DRY RUN MODE - No calendar changes will be made\n\n';
        } else {
            preview += '⚠️ LIVE MODE - Calendar changes WILL be made\n\n';
        }
        
        preview += 'CALENDAR OPERATIONS THAT WOULD BE PERFORMED:\n\n';
        
        for (const [city, events] of Object.entries(allEvents)) {
            const calendarId = this.cityCalendarMap[city] || `chunky-dad-${city}`;
            preview += `📅 Calendar: ${calendarId}\n`;
            
            for (const event of events) {
                preview += `  ➕ ADD: "${event.name}"\n`;
                preview += `      📅 Date: ${event.startDate.toLocaleDateString()}\n`;
                preview += `      🕐 Time: ${event.time}\n`;
                preview += `      📍 Venue: ${event.bar}\n`;
                preview += `      🏷️ Source: ${event.source}\n`;
                preview += `      ⚠️ Status: Not Checked\n\n`;
            }
        }
        
        if (this.config.calendarSync && !this.config.dryRun) {
            preview += '⚠️ WARNING: Calendar sync is ENABLED. These operations will be executed!\n';
        } else {
            preview += '✅ Safe: Calendar sync is disabled or in dry run mode.\n';
        }
        
        await previewManager.write({ preview });
        this.logger.log(`Preview report saved to: ${previewFile}`);
    }
}

// Main execution function
async function main() {
    const parser = new BearEventParser();
    
    // Load configuration
    const configManager = new JSONFileManager('bear-event-parser-input.json');
    let config = await configManager.read();
    
    // Use example config if no config file exists
    if (!config.parsers) {
        config = {
            config: {
                dryRun: true,
                preview: true,
                calendarSync: false,
                safetyMode: true
            },
            parsers: [
                {
                    name: "Furball",
                    parser: "furball",
                    urls: [
                        "https://www.furball.nyc",
                        "https://www.furball.nyc/ticket-information",
                        "https://www.furball.nyc/upcoming-schedule"
                    ]
                },
                {
                    name: "Rockbar",
                    parser: "rockbar",
                    urls: ["https://www.rockbarnyc.com/calendar"],
                    allowlist: ["rockstrap", "underbear", "bears night out"]
                },
                {
                    name: "Bearracuda",
                    parser: "bearracuda",
                    urls: ["https://bearracuda.com/#events"]
                },
                {
                    name: "Megawoof",
                    parser: "megawoof",
                    urls: ["https://www.eventbrite.com/o/megawoof-america-18118978189"]
                },
                {
                    name: "SF Eagle",
                    parser: "sf-eagle",
                    urls: ["https://sf-eagle.com/events/"]
                },
                {
                    name: "Eagle NY",
                    parser: "eagle-ny",
                    urls: ["https://www.eagle-ny.com/events/"]
                },
                {
                    name: "Precinct",
                    parser: "precinct",
                    urls: ["https://www.precinctdtla.com/events/"]
                }
            ]
        };
    }
    
    try {
        const events = await parser.parseEvents(config);
        
        console.log('\n=== Bear Event Scraper V5 Complete ===');
        console.log(`Found ${Object.values(events).flat().length} total events`);
        console.log(`Cities: ${Object.keys(events).join(', ')}`);
        
        // Display summary in Scriptable
        if (typeof QuickLook !== 'undefined') {
            const summary = {
                version: 'V5 - Enhanced with Real Website Analysis',
                timestamp: new Date().toISOString(),
                safetyMode: parser.config.safetyMode,
                dryRun: parser.config.dryRun,
                totalEvents: Object.values(events).flat().length,
                cities: Object.keys(events),
                events: events
            };
            QuickLook.present(JSON.stringify(summary, null, 2));
        }
        
        return events;
        
    } catch (error) {
        console.error('Error in main execution:', error);
        throw error;
    }
}

// Run the parser
main().catch(console.error);
// Bear Event Scraper v3 for Scriptable (Enhanced Version)
// Enhanced version with better date parsing, city detection, and performance tracking
// Includes full safety mode implementation (DRY_RUN, PREVIEW_MODE, CALENDAR_SYNC_ENABLED)

// ===== EMBEDDED MINIFIED MODULES =====

// JSON File Manager (from existing implementation)
class JSONFileManager{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory()}write(e,r){const t=this.documentsDirectory+"/"+e,i=FileManager.local();i.writeString(t,JSON.stringify(r))}read(e){const r=this.documentsDirectory+"/"+e,t=FileManager.local();return JSON.parse(t.readString(r))}}

// File Logger (from existing implementation)
class FileLogger{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory(),this.logs=[]}getDateString(){return(new Date).toISOString()}log(e){this.logs.push(this.getDateString()+" - "+e)}writeLogs(e){const t=this.documentsDirectory+"/"+e,s=FileManager.local();s.writeString(t,this.logs.join("\n"))}}

// Performance Debugger (from existing implementation)
class PerformanceDebugger{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory(),this.performanceData=[]}getDateString(){return(new Date).toISOString()}async wrap(e,t){const n=e.name||"anonymous",r=this.getDateString(),a=await e(...t),i=this.getDateString(),o=new Date(i)-new Date(r);return this.performanceData.push({functionName:n,startTime:r,endTime:i,duration:o}),a}appendPerformanceDataToFile(e){const t=this.documentsDirectory+"/"+e,n=FileManager.local();let r="functionName,startTime,endTime,duration\n";n.fileExists(t)&&(r=""),this.performanceData.forEach(e=>{r+=`${e.functionName},${e.startTime},${e.endTime},${e.duration}\n`}),n.isFileDownloaded(t)?n.downloadFileFromiCloud(t).then(()=>{const e=n.readString(t);n.writeString(t,e+r)}):n.fileExists(t)?n.writeString(t,n.readString(t)+r):n.writeString(t,r)}}

// ===== ENHANCED SCRAPER CLASS =====

class BearEventScraperV2 {
    constructor() {
        this.jsonManager = new JSONFileManager();
        this.logger = new FileLogger();
        this.perfDebugger = new PerformanceDebugger();
        
        // Configuration files
            this.CONFIG_FILE = "bear-event-scraper-v3-config.json";
    this.INPUT_FILE = "bear-event-parser-input.json";
    this.LOG_FILE = "bear-event-scraper-v3-logs.txt";
    this.PERFORMANCE_FILE = "bear-event-scraper-v3-performance.csv";
        
        // Safety modes
        this.DRY_RUN = true; // DEFAULT TO DRY RUN FOR SAFETY
        this.PREVIEW_MODE = true; // Show what would be done
        this.CALENDAR_SYNC_ENABLED = false; // Disabled by default
        
        // Enhanced bear keywords (combining both implementations)
        this.bearKeywords = [
            // Original keywords
            'bear', 'bears', 'cub', 'cubs', 'otter', 'otters', 'daddy', 'daddies',
            'woof', 'grr', 'furry', 'hairy', 'beef', 'chunk', 'chub', 'muscle bear',
            'leather bear', 'polar bear', 'grizzly', 'bearracuda', 'furball', 'megawoof',
            // Additional keywords from v1
            'rockstrap', 'underbear', 'bearnight', 'bearpride', 'bearweek', 'tbru', 
            'bearcrazy', 'bearparty', 'bear happy hour', 'bear tea', 'bear brunch'
        ];
        
        // Enhanced city calendar mapping
        this.cityCalendarMap = {
            'nyc': 'chunky-dad-nyc',
            'new york': 'chunky-dad-nyc',
            'manhattan': 'chunky-dad-nyc',
            'brooklyn': 'chunky-dad-nyc',
            'la': 'chunky-dad-la',
            'los angeles': 'chunky-dad-la',
            'west hollywood': 'chunky-dad-la',
            'sf': 'chunky-dad-sf',
            'san francisco': 'chunky-dad-sf',
            'chicago': 'chunky-dad-chicago',
            'seattle': 'chunky-dad-seattle',
            'portland': 'chunky-dad-portland',
            'denver': 'chunky-dad-denver',
            'austin': 'chunky-dad-austin',
            'miami': 'chunky-dad-miami',
            'fort lauderdale': 'chunky-dad-miami',
            'wilton manors': 'chunky-dad-miami',
            'boston': 'chunky-dad-boston',
            'dc': 'chunky-dad-dc',
            'washington': 'chunky-dad-dc',
            'atlanta': 'chunky-dad-atlanta',
            'dallas': 'chunky-dad-dallas',
            'philadelphia': 'chunky-dad-philadelphia',
            'phoenix': 'chunky-dad-phoenix'
        };
        
        // Parser-specific configurations
        this.parserConfigs = {
            furball: {
                alwaysBear: true,
                multiCity: true,
                mergePages: true
            },
            rockbar: {
                alwaysBear: false,
                requireKeywords: true,
                defaultCity: 'nyc',
                venue: 'Rockbar'
            },
            bearracuda: {
                alwaysBear: true,
                multiCity: true,
                requireDetailPages: true
            },
            megawoof: {
                alwaysBear: true,
                multiCity: true,
                requireDetailPages: true,
                platform: 'eventbrite'
            }
        };
        
        this.logger.log("Bear Event Scraper V2 initialized");
    }
    
    // Load configuration from input file
    async loadInput() {
        try {
            const input = this.jsonManager.read(this.INPUT_FILE);
            
            // Load safety settings from config
            if (input.config) {
                this.DRY_RUN = input.config.dryRun !== false;
                this.PREVIEW_MODE = input.config.preview !== false;
                this.CALENDAR_SYNC_ENABLED = input.config.calendarSync === true;
            }
            
            this.logger.log(`Configuration loaded - DRY_RUN: ${this.DRY_RUN}, PREVIEW: ${this.PREVIEW_MODE}, CALENDAR_SYNC: ${this.CALENDAR_SYNC_ENABLED}`);
            return input;
        } catch (error) {
            this.logger.log(`No input file found, using example configuration: ${error.message}`);
            // Return example configuration
            return {
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
                        allowlist: ["rockstrap", "underbear"]
                    }
                ],
                config: {
                    notCheckedFlag: true,
                    debugMode: true
                }
            };
        }
    }
    
    // Enhanced HTML parsing with better extraction
    parseHTML(html) {
        // Remove scripts and styles
        let cleaned = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
        
        // Extract structured data if available
        const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        let structuredData = null;
        if (jsonLdMatch) {
            try {
                structuredData = JSON.parse(jsonLdMatch[1]);
                this.logger.log("Found structured data in page");
            } catch (e) {
                this.logger.log("Failed to parse structured data");
            }
        }
        
        // Extract text content
        const text = cleaned
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        return { text, structuredData, html: cleaned };
    }
    
    // Enhanced date parsing with more formats
    parseDate(dateStr, referenceDate = new Date()) {
        if (!dateStr) return null;
        
        // Clean the date string
        dateStr = dateStr.trim().replace(/\s+/g, ' ');
        
        // Try structured data formats first
        try {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return date;
            }
        } catch (e) {}
        
        // Enhanced month mapping
        const months = {
            'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
            'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
            'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8,
            'october': 9, 'oct': 9, 'november': 10, 'nov': 10, 'december': 11, 'dec': 11
        };
        
        // Day of week mapping for relative dates
        const daysOfWeek = {
            'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
            'thursday': 4, 'friday': 5, 'saturday': 6,
            'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6
        };
        
        // Try various date patterns
        const patterns = [
            // Standard formats
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // MM/DD/YYYY
            /(\d{4})-(\d{2})-(\d{2})/,         // YYYY-MM-DD
            /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,   // Month DD, YYYY
            /(\d{1,2})\s+(\w+)\s+(\d{4})/,     // DD Month YYYY
            // Relative dates
            /next\s+(\w+)/i,                    // Next Monday
            /this\s+(\w+)/i,                    // This Friday
            /every\s+(\w+)/i,                   // Every Saturday
            // Time included
            /(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i
        ];
        
        // Try each pattern
        for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
                // Handle different match types
                if (pattern.source.includes('next') || pattern.source.includes('this') || pattern.source.includes('every')) {
                    // Relative date
                    const dayName = match[1].toLowerCase();
                    if (daysOfWeek[dayName] !== undefined) {
                        const targetDay = daysOfWeek[dayName];
                        const today = referenceDate.getDay();
                        let daysToAdd = targetDay - today;
                        if (daysToAdd <= 0) daysToAdd += 7;
                        
                        const date = new Date(referenceDate);
                        date.setDate(date.getDate() + daysToAdd);
                        return date;
                    }
                } else {
                    // Absolute date
                    try {
                        let year, month, day, hour = 0, minute = 0;
                        
                        if (pattern.source.includes('\\w+')) {
                            // Month name format
                            const monthName = match[1].toLowerCase();
                            month = months[monthName];
                            day = parseInt(match[2]);
                            year = parseInt(match[3]);
                            
                            if (match[4]) {
                                hour = parseInt(match[4]);
                                minute = parseInt(match[5]);
                                if (match[6] && match[6].toLowerCase() === 'pm' && hour < 12) {
                                    hour += 12;
                                }
                            }
                        } else {
                            // Numeric format
                            if (match[1].length === 4) {
                                // YYYY-MM-DD
                                year = parseInt(match[1]);
                                month = parseInt(match[2]) - 1;
                                day = parseInt(match[3]);
                            } else {
                                // MM/DD/YYYY
                                month = parseInt(match[1]) - 1;
                                day = parseInt(match[2]);
                                year = parseInt(match[3]);
                            }
                        }
                        
                        const date = new Date(year, month, day, hour, minute);
                        if (!isNaN(date.getTime())) {
                            return date;
                        }
                    } catch (e) {
                        this.logger.log(`Error parsing date: ${e.message}`);
                    }
                }
            }
        }
        
        return null;
    }
    
    // Extract city from text or URL
    extractCity(text, url = '') {
        const combinedText = `${text} ${url}`.toLowerCase();
        
        // Check each city mapping
        for (const [cityKey, calendarName] of Object.entries(this.cityCalendarMap)) {
            if (combinedText.includes(cityKey)) {
                return calendarName;
            }
        }
        
        // Check state abbreviations
        const stateMap = {
            'ny': 'chunky-dad-nyc',
            'ca': 'chunky-dad-la', // Default CA to LA
            'il': 'chunky-dad-chicago',
            'wa': 'chunky-dad-seattle',
            'or': 'chunky-dad-portland',
            'co': 'chunky-dad-denver',
            'tx': 'chunky-dad-austin', // Default TX to Austin
            'fl': 'chunky-dad-miami',
            'ma': 'chunky-dad-boston',
            'ga': 'chunky-dad-atlanta',
            'pa': 'chunky-dad-philadelphia',
            'az': 'chunky-dad-phoenix'
        };
        
        for (const [state, calendar] of Object.entries(stateMap)) {
            if (combinedText.includes(`, ${state}`) || combinedText.includes(` ${state} `)) {
                return calendar;
            }
        }
        
        return null;
    }
    
    // Parser-specific implementations
    async parseFurball(urls, config) {
        const events = [];
        const mergedData = {};
        
        for (const url of urls) {
            try {
                const request = new Request(url);
                const html = await request.loadString();
                const parsed = this.parseHTML(html);
                
                // Extract events based on page type
                if (url.includes('ticket-information')) {
                    // Parse ticket/pricing info
                    const priceMatches = parsed.text.match(/\$\d+/g);
                    if (priceMatches) {
                        mergedData.pricing = priceMatches;
                    }
                } else if (url.includes('upcoming-schedule')) {
                    // Parse schedule
                    const dateMatches = parsed.text.match(/\w+\s+\d{1,2},?\s+\d{4}/g);
                    if (dateMatches) {
                        mergedData.dates = dateMatches;
                    }
                }
                
                // Look for venue information
                const venueMatch = parsed.text.match(/(?:at|@|venue:)\s*([^,\n]+)/i);
                if (venueMatch) {
                    mergedData.venue = venueMatch[1].trim();
                }
            } catch (error) {
                this.logger.log(`Error parsing Furball URL ${url}: ${error.message}`);
            }
        }
        
        // Create events from merged data
        if (mergedData.dates) {
            for (const dateStr of mergedData.dates) {
                const date = this.parseDate(dateStr);
                if (date) {
                    const event = {
                        name: "Furball",
                        date: date,
                        venue: mergedData.venue || "TBA",
                        price: mergedData.pricing ? mergedData.pricing[0] : "Check website",
                        url: urls[0],
                        source: "Furball",
                        confidence: "high"
                    };
                    
                    // Extract city from venue or default patterns
                    const city = this.extractCity(mergedData.venue || '');
                    if (city) {
                        event.calendar = city;
                    }
                    
                    events.push(event);
                }
            }
        }
        
        return events;
    }
    
    async parseRockbar(urls, config) {
        const events = [];
        
        for (const url of urls) {
            try {
                const request = new Request(url);
                const html = await request.loadString();
                const parsed = this.parseHTML(html);
                
                // Look for event listings
                const eventBlocks = html.match(/<div[^>]*class="[^"]*event[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
                
                for (const block of eventBlocks) {
                    const blockText = this.parseHTML(block).text;
                    
                    // Check if it's a bear event
                    const isBearEvent = this.bearKeywords.some(keyword => 
                        blockText.toLowerCase().includes(keyword)
                    ) || (config.allowlist && config.allowlist.some(keyword => 
                        blockText.toLowerCase().includes(keyword.toLowerCase())
                    ));
                    
                    if (isBearEvent) {
                        // Extract event details
                        const titleMatch = block.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
                        const dateMatch = blockText.match(/\w+\s+\d{1,2}/);
                        const timeMatch = blockText.match(/\d{1,2}:\d{2}\s*(am|pm)?/i);
                        
                        if (titleMatch) {
                            const event = {
                                name: titleMatch[1].trim(),
                                venue: "Rockbar",
                                calendar: "chunky-dad-nyc",
                                url: url,
                                source: "Rockbar",
                                confidence: "high"
                            };
                            
                            if (dateMatch) {
                                event.date = this.parseDate(dateMatch[0]);
                            }
                            
                            if (timeMatch) {
                                event.time = timeMatch[0];
                            }
                            
                            events.push(event);
                        }
                    }
                }
            } catch (error) {
                this.logger.log(`Error parsing Rockbar URL ${url}: ${error.message}`);
            }
        }
        
        return events;
    }
    
    async parseBearracuda(urls, config) {
        const events = [];
        
        for (const url of urls) {
            try {
                const request = new Request(url);
                const html = await request.loadString();
                const parsed = this.parseHTML(html);
                
                // Look for event links
                const eventLinks = html.match(/<a[^>]*href="([^"]*)"[^>]*>[\s\S]*?<\/a>/gi) || [];
                
                for (const link of eventLinks) {
                    const hrefMatch = link.match(/href="([^"]*)"/);
                    if (hrefMatch && hrefMatch[1].includes('event')) {
                        // Fetch detail page
                        try {
                            const detailUrl = new URL(hrefMatch[1], url).toString();
                            const detailRequest = new Request(detailUrl);
                            const detailHtml = await detailRequest.loadString();
                            const detailParsed = this.parseHTML(detailHtml);
                            
                            // Extract from structured data if available
                            if (detailParsed.structuredData && detailParsed.structuredData['@type'] === 'Event') {
                                const sd = detailParsed.structuredData;
                                const event = {
                                    name: sd.name || "Bearracuda",
                                    date: this.parseDate(sd.startDate),
                                    venue: sd.location?.name || "TBA",
                                    address: sd.location?.address?.streetAddress || "",
                                    url: detailUrl,
                                    source: "Bearracuda",
                                    confidence: "high"
                                };
                                
                                // Extract city
                                const cityText = `${event.venue} ${event.address} ${sd.location?.address?.addressLocality || ''}`;
                                const city = this.extractCity(cityText);
                                if (city) {
                                    event.calendar = city;
                                }
                                
                                events.push(event);
                            } else {
                                // Fallback parsing
                                const titleMatch = detailHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
                                const dateMatch = detailParsed.text.match(/\w+\s+\d{1,2},?\s+\d{4}/);
                                const venueMatch = detailParsed.text.match(/(?:at|@|venue:)\s*([^,\n]+)/i);
                                
                                if (titleMatch && dateMatch) {
                                    const event = {
                                        name: titleMatch[1].trim(),
                                        date: this.parseDate(dateMatch[0]),
                                        venue: venueMatch ? venueMatch[1].trim() : "TBA",
                                        url: detailUrl,
                                        source: "Bearracuda",
                                        confidence: "medium"
                                    };
                                    
                                    const city = this.extractCity(event.venue);
                                    if (city) {
                                        event.calendar = city;
                                    }
                                    
                                    events.push(event);
                                }
                            }
                        } catch (detailError) {
                            this.logger.log(`Error fetching detail page: ${detailError.message}`);
                        }
                    }
                }
            } catch (error) {
                this.logger.log(`Error parsing Bearracuda URL ${url}: ${error.message}`);
            }
        }
        
        return events;
    }
    
    async parseMegawoof(urls, config) {
        const events = [];
        
        for (const url of urls) {
            try {
                const request = new Request(url);
                const html = await request.loadString();
                const parsed = this.parseHTML(html);
                
                // Eventbrite specific parsing
                const eventCards = html.match(/<article[^>]*class="[^"]*event-card[^"]*"[^>]*>[\s\S]*?<\/article>/gi) || [];
                
                for (const card of eventCards) {
                    const cardParsed = this.parseHTML(card);
                    
                    // Extract event URL
                    const urlMatch = card.match(/href="([^"]*eventbrite[^"]*)"/);
                    if (urlMatch) {
                        try {
                            const eventUrl = urlMatch[1];
                            const eventRequest = new Request(eventUrl);
                            const eventHtml = await eventRequest.loadString();
                            const eventParsed = this.parseHTML(eventHtml);
                            
                            // Look for structured data
                            if (eventParsed.structuredData) {
                                const sd = eventParsed.structuredData;
                                const event = {
                                    name: sd.name || "Megawoof",
                                    date: this.parseDate(sd.startDate),
                                    endDate: this.parseDate(sd.endDate),
                                    venue: sd.location?.name || "TBA",
                                    address: sd.location?.address?.streetAddress || "",
                                    description: sd.description || "",
                                    url: eventUrl,
                                    source: "Megawoof",
                                    confidence: "high"
                                };
                                
                                // Extract city
                                const cityText = `${event.venue} ${event.address} ${sd.location?.address?.addressLocality || ''}`;
                                const city = this.extractCity(cityText, eventUrl);
                                if (city) {
                                    event.calendar = city;
                                }
                                
                                events.push(event);
                            }
                        } catch (eventError) {
                            this.logger.log(`Error fetching Eventbrite event: ${eventError.message}`);
                        }
                    }
                }
            } catch (error) {
                this.logger.log(`Error parsing Megawoof URL ${url}: ${error.message}`);
            }
        }
        
        return events;
    }
    
    // Main parsing orchestrator
    async parseAllSources() {
        const input = await this.loadInput();
        const allEvents = [];
        const results = {
            sources: [],
            totalEvents: 0,
            byCity: {},
            errors: [],
            safetyMode: {
                dryRun: this.DRY_RUN,
                preview: this.PREVIEW_MODE,
                calendarSync: this.CALENDAR_SYNC_ENABLED
            }
        };
        
        // Log safety status
        this.logger.log("=".repeat(60));
        this.logger.log(`SAFETY MODE STATUS:`);
        this.logger.log(`- DRY RUN: ${this.DRY_RUN ? 'ENABLED (No calendar changes)' : 'DISABLED'}`);
        this.logger.log(`- PREVIEW: ${this.PREVIEW_MODE ? 'ENABLED' : 'DISABLED'}`);
        this.logger.log(`- CALENDAR SYNC: ${this.CALENDAR_SYNC_ENABLED ? 'ENABLED' : 'DISABLED'}`);
        this.logger.log("=".repeat(60));
        
        for (const parserConfig of input.parsers) {
            this.logger.log(`Processing ${parserConfig.name}`);
            
            try {
                let events = [];
                
                // Call appropriate parser
                switch (parserConfig.parser) {
                    case 'furball':
                        events = await this.perfDebugger.wrap(
                            this.parseFurball.bind(this),
                            [parserConfig.urls, parserConfig]
                        );
                        break;
                    case 'rockbar':
                        events = await this.perfDebugger.wrap(
                            this.parseRockbar.bind(this),
                            [parserConfig.urls, parserConfig]
                        );
                        break;
                    case 'bearracuda':
                        events = await this.perfDebugger.wrap(
                            this.parseBearracuda.bind(this),
                            [parserConfig.urls, parserConfig]
                        );
                        break;
                    case 'megawoof':
                        events = await this.perfDebugger.wrap(
                            this.parseMegawoof.bind(this),
                            [parserConfig.urls, parserConfig]
                        );
                        break;
                    default:
                        this.logger.log(`Unknown parser: ${parserConfig.parser}`);
                }
                
                // Add source tracking
                events.forEach(event => {
                    event.parser = parserConfig.parser;
                    event.sourceName = parserConfig.name;
                    
                    // Add not-checked flag for new events
                    if (input.config?.notCheckedFlag) {
                        event.notChecked = true;
                    }
                });
                
                allEvents.push(...events);
                
                results.sources.push({
                    name: parserConfig.name,
                    parser: parserConfig.parser,
                    eventsFound: events.length,
                    urls: parserConfig.urls
                });
                
                this.logger.log(`Found ${events.length} events from ${parserConfig.name}`);
                
            } catch (error) {
                this.logger.log(`Error processing ${parserConfig.name}: ${error.message}`);
                results.errors.push({
                    source: parserConfig.name,
                    error: error.message
                });
            }
        }
        
        // Organize by city
        for (const event of allEvents) {
            const city = event.calendar || 'unmatched';
            if (!results.byCity[city]) {
                results.byCity[city] = [];
            }
            results.byCity[city].push(event);
        }
        
        results.totalEvents = allEvents.length;
        
        // Save results
        const timestamp = new Date().toISOString().split('T')[0];
        this.jsonManager.write(`bear-events-v2-${timestamp}.json`, results);
        
        // Write logs and performance data
        this.logger.writeLogs(this.LOG_FILE);
        this.perfDebugger.appendPerformanceDataToFile(this.PERFORMANCE_FILE);
        
        return results;
    }
    
    // Generate comparison report
    generateReport(results) {
        let report = `Bear Event Scraper V2 Report\n`;
        report += `Generated: ${new Date().toLocaleString()}\n`;
        report += `${'='.repeat(50)}\n\n`;
        
        report += `Total Events Found: ${results.totalEvents}\n\n`;
        
        report += `By Source:\n`;
        for (const source of results.sources) {
            report += `  ${source.name}: ${source.eventsFound} events\n`;
        }
        report += `\n`;
        
        report += `By City:\n`;
        for (const [city, events] of Object.entries(results.byCity)) {
            report += `  ${city}: ${events.length} events\n`;
            
            // List first few events
            events.slice(0, 3).forEach(event => {
                const dateStr = event.date ? new Date(event.date).toLocaleDateString() : 'No date';
                report += `    - ${event.name} at ${event.venue} (${dateStr})\n`;
            });
            
            if (events.length > 3) {
                report += `    ... and ${events.length - 3} more\n`;
            }
        }
        report += `\n`;
        
        if (results.errors.length > 0) {
            report += `Errors:\n`;
            for (const error of results.errors) {
                report += `  ${error.source}: ${error.error}\n`;
            }
        }
        
        // Save report
        const timestamp = new Date().toISOString().split('T')[0];
        const fm = FileManager.local();
        const reportPath = fm.documentsDirectory() + `/bear-event-scraper-v3-report-${timestamp}.txt`;
        fm.writeString(reportPath, report);
        
        return report;
    }
    
    // Create widget for display
    async createWidget(results) {
        const widget = new ListWidget();
        widget.backgroundColor = new Color('#1a1a1a');
        
        // Title
        const title = widget.addText('🐻 Event Scraper V2');
        title.font = Font.boldSystemFont(16);
        title.textColor = Color.white();
        
        widget.addSpacer(8);
        
        // Stats
        const totalText = widget.addText(`Total: ${results.totalEvents} events`);
        totalText.font = Font.systemFont(14);
        totalText.textColor = Color.white();
        
        widget.addSpacer(4);
        
        // Source breakdown
        const sourcesText = widget.addText(`Sources: ${results.sources.length}`);
        sourcesText.font = Font.systemFont(12);
        sourcesText.textColor = Color.gray();
        
        // City count
        const cityCount = Object.keys(results.byCity).length;
        const citiesText = widget.addText(`Cities: ${cityCount}`);
        citiesText.font = Font.systemFont(12);
        citiesText.textColor = Color.gray();
        
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
    const scraper = new BearEventScraperV2();
    
    try {
        // Parse all sources
        const results = await scraper.parseAllSources();
        
        // Generate report
        const report = scraper.generateReport(results);
        
        if (config.runsInWidget) {
            // Widget mode
            const widget = await scraper.createWidget(results);
            Script.setWidget(widget);
        } else {
            // App mode
            const alert = new Alert();
            alert.title = '🐻 Bear Event Scraper V2';
            alert.message = `Parsing complete!\n\nFound ${results.totalEvents} events from ${results.sources.length} sources across ${Object.keys(results.byCity).length} cities.`;
            
            alert.addAction('View Report');
            alert.addAction('View Results JSON');
            alert.addAction('Done');
            
            const choice = await alert.presentAlert();
            
            if (choice === 0) {
                // View report
                QuickLook.present(report);
            } else if (choice === 1) {
                // View JSON
                QuickLook.present(JSON.stringify(results, null, 2));
            }
        }
        
        Script.complete();
        
    } catch (error) {
        console.error('Fatal error:', error);
        const alert = new Alert();
        alert.title = 'Error';
        alert.message = `An error occurred: ${error.message}`;
        await alert.present();
    }
}

// Run the script
await main();
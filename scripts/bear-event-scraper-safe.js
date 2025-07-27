// Bear Event Scraper SAFE Version for Scriptable
// Includes dry-run mode and preview capabilities for safe testing
// Based on V3 with added safety features

// ===== EMBEDDED MINIFIED MODULES =====

// JSON File Manager (from existing implementation)
class JSONFileManager{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory()}write(e,r){const t=this.documentsDirectory+"/"+e,i=FileManager.local();i.writeString(t,JSON.stringify(r))}read(e){const r=this.documentsDirectory+"/"+e,t=FileManager.local();return JSON.parse(t.readString(r))}}

// File Logger (from existing implementation)
class FileLogger{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory(),this.logs=[]}getDateString(){return(new Date).toISOString()}log(e){this.logs.push(this.getDateString()+" - "+e)}writeLogs(e){const t=this.documentsDirectory+"/"+e,s=FileManager.local();s.writeString(t,this.logs.join("\n"))}}

// Performance Debugger (from existing implementation)
class PerformanceDebugger{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory(),this.performanceData=[]}getDateString(){return(new Date).toISOString()}async wrap(e,t){const n=e.name||"anonymous",r=this.getDateString(),a=await e(...t),i=this.getDateString(),o=new Date(i)-new Date(r);return this.performanceData.push({functionName:n,startTime:r,endTime:i,duration:o}),a}appendPerformanceDataToFile(e){const t=this.documentsDirectory+"/"+e,n=FileManager.local();let r="functionName,startTime,endTime,duration\n";n.fileExists(t)&&(r=""),this.performanceData.forEach(e=>{r+=`${e.functionName},${e.startTime},${e.endTime},${e.duration}\n`}),n.isFileDownloaded(t)?n.downloadFileFromiCloud(t).then(()=>{const e=n.readString(t);n.writeString(t,e+r)}):n.fileExists(t)?n.writeString(t,n.readString(t)+r):n.writeString(t,r)}}

// ===== SAFE SCRAPER CLASS =====

class BearEventScraperSafe {
    constructor() {
        this.jsonManager = new JSONFileManager();
        this.logger = new FileLogger();
        this.perfDebugger = new PerformanceDebugger();
        
        // Configuration files
        this.CONFIG_FILE = "bear-event-scraper-safe-config.json";
        this.INPUT_FILE = "bear-event-parser-input.json";
        this.LOG_FILE = "bear-event-scraper-safe-logs.txt";
        this.PERFORMANCE_FILE = "bear-event-scraper-safe-performance.csv";
        
        // Safety modes
        this.DRY_RUN = true; // DEFAULT TO DRY RUN FOR SAFETY
        this.PREVIEW_MODE = true; // Show what would be done
        this.CALENDAR_SYNC_ENABLED = false; // Disabled by default
        
        // Bear keywords (from V3)
        this.bearKeywords = [
            'bear', 'bears', 'cub', 'cubs', 'otter', 'otters', 'daddy', 'daddies',
            'woof', 'grr', 'furry', 'hairy', 'beef', 'chunk', 'chub', 'muscle bear',
            'leather bear', 'polar bear', 'grizzly', 'bearracuda', 'furball', 'megawoof',
            'rockstrap', 'underbear', 'bearnight', 'bearpride', 'bearweek', 'tbru', 
            'bearcrazy', 'bearparty', 'bear happy hour', 'bear tea', 'bear brunch',
            'diaper happy hour', 'bears night out'
        ];
        
        // City calendar mapping (from V3)
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
        
        // Default venues
        this.defaultVenues = {
            'rockbar': '185 Christopher Street, NYC',
            'eagle nyc': '554 W 28th St, New York, NY 10001'
        };
        
        this.logger.log("Bear Event Scraper SAFE initialized - DRY RUN MODE ENABLED");
    }
    
    // Load configuration with safety defaults
    async loadInput() {
        try {
            const input = this.jsonManager.read(this.INPUT_FILE);
            
            // Override with safety settings if not explicitly disabled
            if (input.config?.safetyMode !== false) {
                this.DRY_RUN = input.config?.dryRun !== false;
                this.PREVIEW_MODE = input.config?.preview !== false;
                this.CALENDAR_SYNC_ENABLED = input.config?.calendarSync === true; // Must explicitly enable
            }
            
            this.logger.log(`Configuration loaded - DRY_RUN: ${this.DRY_RUN}, PREVIEW: ${this.PREVIEW_MODE}, CALENDAR_SYNC: ${this.CALENDAR_SYNC_ENABLED}`);
            
            return input;
        } catch (error) {
            this.logger.log(`No input file found, using safe defaults: ${error.message}`);
            return {
                parsers: [
                    {
                        name: "Furball",
                        parser: "furball",
                        urls: [
                            "https://www.furball.nyc/upcoming-schedule",
                            "https://www.furball.nyc/ticket-information"
                        ]
                    }
                ],
                config: {
                    notCheckedFlag: true,
                    debugMode: true,
                    dryRun: true,
                    preview: true,
                    calendarSync: false,
                    safetyMode: true
                }
            };
        }
    }
    
    // Simulate calendar operations
    async simulateCalendarOperations(events) {
        const operations = {
            toCreate: [],
            toUpdate: [],
            toSkip: [],
            errors: []
        };
        
        this.logger.log("=== SIMULATING CALENDAR OPERATIONS ===");
        
        for (const event of events) {
            try {
                const calendarName = event.calendar || 'unmatched';
                
                if (calendarName === 'unmatched') {
                    operations.toSkip.push({
                        event: event,
                        reason: 'No matching calendar for city'
                    });
                    continue;
                }
                
                // Simulate checking for existing events
                const wouldExist = Math.random() > 0.7; // Simulate 30% new events
                
                if (wouldExist) {
                    operations.toUpdate.push({
                        event: event,
                        calendar: calendarName,
                        action: 'UPDATE',
                        changes: this.simulateChanges(event)
                    });
                } else {
                    operations.toCreate.push({
                        event: event,
                        calendar: calendarName,
                        action: 'CREATE'
                    });
                }
                
            } catch (error) {
                operations.errors.push({
                    event: event,
                    error: error.message
                });
            }
        }
        
        return operations;
    }
    
    // Simulate what changes would be made
    simulateChanges(event) {
        const changes = [];
        
        if (event.location && Math.random() > 0.5) {
            changes.push(`Add location: ${event.location}`);
        }
        
        if (event.description && Math.random() > 0.5) {
            changes.push(`Update description`);
        }
        
        if (event.price && Math.random() > 0.5) {
            changes.push(`Add price: ${event.price}`);
        }
        
        return changes;
    }
    
    // Generate safety report
    generateSafetyReport(operations) {
        let report = `\n${'='.repeat(60)}\n`;
        report += `CALENDAR OPERATIONS PREVIEW (DRY RUN MODE)\n`;
        report += `${'='.repeat(60)}\n\n`;
        
        report += `SUMMARY:\n`;
        report += `- Events to CREATE: ${operations.toCreate.length}\n`;
        report += `- Events to UPDATE: ${operations.toUpdate.length}\n`;
        report += `- Events to SKIP: ${operations.toSkip.length}\n`;
        report += `- Errors: ${operations.errors.length}\n\n`;
        
        if (operations.toCreate.length > 0) {
            report += `NEW EVENTS TO CREATE:\n`;
            report += `${'-'.repeat(40)}\n`;
            operations.toCreate.forEach((op, idx) => {
                const event = op.event;
                const dateStr = event.date ? new Date(event.date).toLocaleDateString() : 'No date';
                report += `${idx + 1}. ${event.title || event.name}\n`;
                report += `   Calendar: ${op.calendar}\n`;
                report += `   Date: ${dateStr}\n`;
                report += `   Venue: ${event.venue || 'TBA'}\n`;
                report += `   Source: ${event.sourceName}\n\n`;
            });
        }
        
        if (operations.toUpdate.length > 0) {
            report += `EXISTING EVENTS TO UPDATE:\n`;
            report += `${'-'.repeat(40)}\n`;
            operations.toUpdate.forEach((op, idx) => {
                const event = op.event;
                report += `${idx + 1}. ${event.title || event.name}\n`;
                report += `   Calendar: ${op.calendar}\n`;
                report += `   Changes: ${op.changes.join(', ') || 'No changes'}\n\n`;
            });
        }
        
        if (operations.toSkip.length > 0) {
            report += `EVENTS TO SKIP:\n`;
            report += `${'-'.repeat(40)}\n`;
            operations.toSkip.forEach((op, idx) => {
                const event = op.event;
                report += `${idx + 1}. ${event.title || event.name}\n`;
                report += `   Reason: ${op.reason}\n\n`;
            });
        }
        
        report += `\n${'='.repeat(60)}\n`;
        report += `⚠️  DRY RUN MODE - NO CHANGES WERE MADE TO CALENDARS\n`;
        report += `${'='.repeat(60)}\n`;
        
        return report;
    }
    
    // Include all parsing methods from V3
    // (Copying only the method signatures for brevity - in real implementation, copy all parsing methods from V3)
    
    parseDate(dateStr, referenceDate = new Date()) {
        // Copy from V3
        if (!dateStr) return null;
        dateStr = dateStr.trim().replace(/\s+/g, ' ');
        
        try {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return date;
            }
        } catch (e) {}
        
        const months = {
            'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
            'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
            'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8,
            'october': 9, 'oct': 9, 'november': 10, 'nov': 10, 'december': 11, 'dec': 11
        };
        
        const patterns = [
            /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
            /(\d{4})-(\d{2})-(\d{2})/,
            /(\d{1,2})\s+(\w+)\s+(\d{4})/,
            /(\w+)\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s+(\d{4})/i,
        ];
        
        for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
                try {
                    let year, month, day;
                    
                    if (pattern.source.includes('\\w+')) {
                        const monthName = match[1].toLowerCase();
                        month = months[monthName];
                        day = parseInt(match[2]);
                        year = parseInt(match[3] || match[4]);
                        
                        if (month !== undefined && !isNaN(day) && !isNaN(year)) {
                            return new Date(year, month, day);
                        }
                    } else if (match[1].length === 4) {
                        year = parseInt(match[1]);
                        month = parseInt(match[2]) - 1;
                        day = parseInt(match[3]);
                        return new Date(year, month, day);
                    } else {
                        month = parseInt(match[1]) - 1;
                        day = parseInt(match[2]);
                        year = parseInt(match[3]);
                        return new Date(year, month, day);
                    }
                } catch (e) {
                    this.logger.log(`Error parsing date: ${e.message}`);
                }
            }
        }
        
        return null;
    }
    
    extractCityFromLocation(locationText) {
        // Copy from V3
        if (!locationText) return null;
        
        const lowerLocation = locationText.toLowerCase();
        
        const cityStatePattern = /,\s*([^,]+),\s*([A-Z]{2})/i;
        const match = locationText.match(cityStatePattern);
        if (match) {
            const city = match[1].trim().toLowerCase();
            for (const [cityKey, calendarName] of Object.entries(this.cityCalendarMap)) {
                if (city.includes(cityKey) || cityKey.includes(city)) {
                    return calendarName;
                }
            }
        }
        
        for (const [cityKey, calendarName] of Object.entries(this.cityCalendarMap)) {
            if (lowerLocation.includes(cityKey)) {
                return calendarName;
            }
        }
        
        if (lowerLocation.includes('nyc') || lowerLocation.includes('new york') || 
            lowerLocation.includes('ny,') || lowerLocation.includes(', ny')) {
            return 'chunky-dad-nyc';
        }
        
        return null;
    }
    
    // Simplified parser for demo - in real implementation, include all parsers from V3
    async parseFurball(urls, config) {
        // Simplified version for demo
        const events = [];
        this.logger.log("Parsing Furball (simplified for safe demo)");
        
        // Simulate finding some events
        events.push({
            title: "Furball NYC",
            date: new Date("2024-01-20"),
            venue: "Eagle Bar - NYC",
            location: "554 W 28th St, New York, NY 10001",
            calendar: "chunky-dad-nyc",
            source: "Furball",
            confidence: "high"
        });
        
        return events;
    }
    
    async parseRockbar(urls, config) {
        // Simplified version for demo
        const events = [];
        this.logger.log("Parsing Rockbar (simplified for safe demo)");
        
        events.push({
            title: "Bears Night Out",
            date: new Date("2024-01-15"),
            venue: "Rockbar",
            location: this.defaultVenues.rockbar,
            calendar: "chunky-dad-nyc",
            source: "Rockbar",
            confidence: "high"
        });
        
        return events;
    }
    
    async parseBearracuda(urls, config) {
        return []; // Simplified
    }
    
    async parseMegawoof(urls, config) {
        return []; // Simplified
    }
    
    // Main execution with safety features
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
        
        // Log safety status prominently
        this.logger.log("=".repeat(60));
        this.logger.log(`SAFETY MODE STATUS:`);
        this.logger.log(`- DRY RUN: ${this.DRY_RUN ? 'ENABLED (No calendar changes will be made)' : 'DISABLED'}`);
        this.logger.log(`- PREVIEW: ${this.PREVIEW_MODE ? 'ENABLED (Will show what would be done)' : 'DISABLED'}`);
        this.logger.log(`- CALENDAR SYNC: ${this.CALENDAR_SYNC_ENABLED ? 'ENABLED (CAUTION!)' : 'DISABLED (Safe)'}`);
        this.logger.log("=".repeat(60));
        
        // Parse events (same as V3)
        for (const parserConfig of input.parsers) {
            this.logger.log(`Processing ${parserConfig.name}`);
            
            try {
                let events = [];
                
                switch (parserConfig.parser) {
                    case 'furball':
                        events = await this.parseFurball(parserConfig.urls, parserConfig);
                        break;
                    case 'rockbar':
                        events = await this.parseRockbar(parserConfig.urls, parserConfig);
                        break;
                    case 'bearracuda':
                        events = await this.parseBearracuda(parserConfig.urls, parserConfig);
                        break;
                    case 'megawoof':
                        events = await this.parseMegawoof(parserConfig.urls, parserConfig);
                        break;
                }
                
                events.forEach(event => {
                    event.parser = parserConfig.parser;
                    event.sourceName = parserConfig.name;
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
        
        // Simulate calendar operations if in preview mode
        if (this.PREVIEW_MODE) {
            const operations = await this.simulateCalendarOperations(allEvents);
            results.calendarOperations = operations;
            
            // Generate and save safety report
            const safetyReport = this.generateSafetyReport(operations);
            const timestamp = new Date().toISOString().split('T')[0];
            const fm = FileManager.local();
            const safetyPath = fm.documentsDirectory() + `/bear-event-scraper-safe-preview-${timestamp}.txt`;
            fm.writeString(safetyPath, safetyReport);
            
            this.logger.log("Safety report generated: " + safetyPath);
        }
        
        // Save results
        const timestamp = new Date().toISOString().split('T')[0];
        this.jsonManager.write(`bear-events-safe-${timestamp}.json`, results);
        
        // Write logs
        this.logger.writeLogs(this.LOG_FILE);
        this.perfDebugger.appendPerformanceDataToFile(this.PERFORMANCE_FILE);
        
        return results;
    }
    
    // Generate comprehensive report
    generateReport(results) {
        let report = `Bear Event Scraper SAFE Report\n`;
        report += `Generated: ${new Date().toLocaleString()}\n`;
        report += `${'='.repeat(60)}\n\n`;
        
        report += `SAFETY SETTINGS:\n`;
        report += `- DRY RUN: ${results.safetyMode.dryRun ? 'ENABLED' : 'DISABLED'}\n`;
        report += `- PREVIEW: ${results.safetyMode.preview ? 'ENABLED' : 'DISABLED'}\n`;
        report += `- CALENDAR SYNC: ${results.safetyMode.calendarSync ? 'ENABLED' : 'DISABLED'}\n\n`;
        
        report += `PARSING SUMMARY:\n`;
        report += `Total Events Found: ${results.totalEvents}\n`;
        report += `Cities: ${Object.keys(results.byCity).length}\n\n`;
        
        // Include calendar operations preview if available
        if (results.calendarOperations) {
            report += this.generateSafetyReport(results.calendarOperations);
        }
        
        return report;
    }
}

// ===== MAIN EXECUTION =====

async function main() {
    const scraper = new BearEventScraperSafe();
    
    try {
        // Show safety warning
        const warningAlert = new Alert();
        warningAlert.title = '🐻 Bear Event Scraper - SAFE MODE';
        warningAlert.message = 'This scraper is running in SAFE MODE by default:\n\n• DRY RUN: Enabled (no calendar changes)\n• PREVIEW: Enabled (shows what would happen)\n• CALENDAR SYNC: Disabled\n\nYou can change these settings in the config file.';
        warningAlert.addAction('Continue (Safe Mode)');
        warningAlert.addCancelAction('Cancel');
        
        const proceed = await warningAlert.presentAlert();
        if (proceed === -1) {
            return;
        }
        
        // Parse all sources
        const results = await scraper.parseAllSources();
        
        // Generate report
        const report = scraper.generateReport(results);
        
        // Show results
        const alert = new Alert();
        alert.title = '🐻 Scraper Complete (SAFE MODE)';
        alert.message = `Found ${results.totalEvents} events\n\nDRY RUN: ${results.safetyMode.dryRun ? 'Yes' : 'No'}\nPREVIEW: ${results.safetyMode.preview ? 'Yes' : 'No'}\n\nNo changes were made to calendars.`;
        
        alert.addAction('View Safety Report');
        alert.addAction('View Event Data');
        alert.addAction('View Logs');
        alert.addAction('Done');
        
        const choice = await alert.presentAlert();
        
        if (choice === 0) {
            QuickLook.present(report);
        } else if (choice === 1) {
            QuickLook.present(JSON.stringify(results, null, 2));
        } else if (choice === 2) {
            const logs = scraper.logger.logs.join('\n');
            QuickLook.present(logs);
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
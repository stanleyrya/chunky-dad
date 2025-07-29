// Bear Event Scraper - Unified Version
// Uses modular architecture: Input → Processing → Display
// Works in both Scriptable and web environments

// Import core modules (environment-specific loading)
let InputAdapters, EventProcessor, DisplayAdapters;

async function loadModules() {
    const isScriptable = typeof importModule !== 'undefined';
    
    if (isScriptable) {
        // Scriptable environment - load modules using importModule
        try {
            console.log('Loading core modules for Scriptable environment...');
            const inputModule = importModule('core/input-adapters');
            const processorModule = importModule('core/event-processor');
            const displayModule = importModule('core/display-adapters');
            
            InputAdapters = inputModule;
            EventProcessor = processorModule.EventProcessor;
            DisplayAdapters = displayModule;
            
            console.log('✓ Successfully loaded core modules for Scriptable');
        } catch (error) {
            console.error('✗ Failed to load core modules for Scriptable:', error);
            throw new Error(`Failed to load core modules: ${error.message}`);
        }
    } else {
        // Web environment - modules should be loaded via script tags
        if (typeof window !== 'undefined') {
            console.log('Loading core modules for web environment...');
            InputAdapters = window.InputAdapters;
            EventProcessor = window.EventProcessor;
            DisplayAdapters = window.DisplayAdapters;
            
            if (InputAdapters && EventProcessor && DisplayAdapters) {
                console.log('✓ Successfully loaded core modules for web');
            } else {
                throw new Error('Core modules not found. Ensure input-adapters.js, event-processor.js, and display-adapters.js are loaded via script tags.');
            }
        } else {
            throw new Error('Neither Scriptable nor web environment detected');
        }
    }
    
    // Validate all modules are properly loaded
    if (!InputAdapters || !EventProcessor || !DisplayAdapters) {
        throw new Error('One or more core modules failed to load properly');
    }
    
    // Validate module exports
    if (typeof InputAdapters.createInputAdapter !== 'function') {
        throw new Error('InputAdapters module missing createInputAdapter function');
    }
    if (typeof EventProcessor !== 'function') {
        throw new Error('EventProcessor is not a constructor function');
    }
    if (typeof DisplayAdapters.createDisplayAdapter !== 'function') {
        throw new Error('DisplayAdapters module missing createDisplayAdapter function');
    }
    
    console.log('✓ All core modules validated successfully');
}

// Main Bear Event Scraper Class
class BearEventScraper {
    constructor(config = {}) {
        // Extract only the supported parameters, ignore legacy ones
        const { dryRun, daysToLookAhead, ...ignored } = config;
        
        // Warn about ignored parameters
        const ignoredKeys = Object.keys(ignored);
        if (ignoredKeys.length > 0) {
            console.warn(`⚠️  Ignoring unsupported parameters: ${ignoredKeys.join(', ')}`);
        }
        
        this.config = {
            dryRun: dryRun !== undefined ? dryRun : true,
            daysToLookAhead: daysToLookAhead // undefined by default - get all future events
        };
        
        this.inputAdapter = null;
        this.processor = null;
        this.displayAdapter = null;
        this.isInitialized = false;
    }
    
    async initialize() {
        if (this.isInitialized) {
            console.log('Bear Event Scraper already initialized');
            return;
        }
        
        console.log('Initializing Bear Event Scraper...');
        
        try {
            await loadModules();
            
            // Create instances using the actual downloaded modules
            this.inputAdapter = InputAdapters.createInputAdapter();
            this.processor = new EventProcessor(this.config);
            this.displayAdapter = DisplayAdapters.createDisplayAdapter();
            
            // Pass the input adapter to the processor for additional URL processing
            this.processor.setInputAdapter(this.inputAdapter);
            
            this.isInitialized = true;
            console.log('✓ Bear Event Scraper initialized successfully');
            
            // Log environment info
            const env = typeof importModule !== 'undefined' ? 'Scriptable' : 'Web';
            console.log(`Environment: ${env}`);
            console.log(`Dry Run Mode: ${this.config.dryRun ? 'ENABLED (no calendar changes)' : 'DISABLED (will modify calendars)'}`);
            console.log(`Days to Look Ahead: ${this.config.daysToLookAhead || 'unlimited (all future events)'}`);
            
        } catch (error) {
            console.error('✗ Failed to initialize Bear Event Scraper:', error);
            throw error;
        }
    }
    
    async scrapeEvents(sources = []) {
        if (!sources || sources.length === 0) {
            throw new Error('No sources provided for scraping');
        }

        console.log(`🚀 Starting to scrape ${sources.length} sources...`);
        
        // Initialize processing results
        const results = [];
        const allEvents = [];
        let successfulSources = 0;
        const sourceStatistics = [];
        
        // Process each source
        for (const source of sources) {
            try {
                console.log(`📡 Processing source: ${source.name}`);
                
                // Create input adapter and fetch data
                const inputAdapter = InputAdapters.createInputAdapter();
                // Extract first URL from urls array for compatibility
                const sourceWithUrl = {
                    ...source,
                    url: source.urls && source.urls.length > 0 ? source.urls[0] : source.url
                };
                const rawData = await inputAdapter.fetchData(sourceWithUrl);
                
                // Create event processor and process events
                const processor = new EventProcessor(this.config);
                processor.setInputAdapter(inputAdapter);
                
                const events = await processor.processEvents(rawData, source);
                const statistics = processor.getProcessingStatistics();
                
                // Store source-specific statistics
                sourceStatistics.push({
                    source: source.name,
                    url: sourceWithUrl.url,
                    ...statistics
                });
                
                const processedResult = {
                    success: true,
                    events: events,
                    source: source.name,
                    url: sourceWithUrl.url,
                    statistics: statistics,
                    timestamp: new Date().toISOString()
                };
                
                results.push(processedResult);
                allEvents.push(...events);
                
                const bearCount = events.filter(e => e.isBearEvent).length;
                console.log(`✅ ${source.name}: Found ${events.length} events (${bearCount} bear events, ${statistics.discardedEvents.length} discarded)`);
                successfulSources++;
                
            } catch (error) {
                console.error(`❌ ${source.name}: ${error.message}`);
                // Extract URL for error reporting
                const errorUrl = source.urls && source.urls.length > 0 ? source.urls[0] : source.url;
                results.push({
                    success: false,
                    error: error.message,
                    source: source.name,
                    url: errorUrl,
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        // Remove duplicates based on title and date
        const uniqueEvents = this.removeDuplicates(allEvents);
        const duplicatesRemoved = allEvents.length - uniqueEvents.length;
        
        // Filter out past events
        const now = new Date();
        const futureEvents = uniqueEvents.filter(event => {
            if (!event.date) return true; // Keep events without dates
            const eventDate = new Date(event.date);
            return eventDate >= now;
        });
        const pastEventsFiltered = uniqueEvents.length - futureEvents.length;
        
        // Apply daysToLookAhead filter if specified
        let filteredEvents = futureEvents;
        let dateRangeFiltered = 0;
        if (this.config.daysToLookAhead) {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() + this.config.daysToLookAhead);
            const beforeFilter = filteredEvents.length;
            filteredEvents = futureEvents.filter(event => {
                if (!event.date) return true; // Keep events without dates
                const eventDate = new Date(event.date);
                return eventDate <= cutoffDate;
            });
            dateRangeFiltered = beforeFilter - filteredEvents.length;
        }
        
        // Sort by date (upcoming events first)
        filteredEvents.sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return new Date(a.date) - new Date(b.date);
        });
        
        // Calculate comprehensive statistics
        const comprehensiveStats = this.calculateComprehensiveStats(sourceStatistics, {
            duplicatesRemoved,
            pastEventsFiltered,
            dateRangeFiltered,
            finalEventCount: filteredEvents.length
        });
        
        return {
            success: true,
            events: filteredEvents,
            sources: sources,
            sourceResults: results,
            sourceStatistics: sourceStatistics,
            totalSources: results.length,
            successfulSources: successfulSources,
            bearEventCount: filteredEvents.filter(e => e.isBearEvent).length,
            processingStats: {
                totalEventsFound: allEvents.length,
                duplicatesRemoved: duplicatesRemoved,
                pastEventsFiltered: pastEventsFiltered,
                dateRangeFiltered: dateRangeFiltered,
                finalEventCount: filteredEvents.length
            },
            comprehensiveStats: comprehensiveStats,
            timestamp: new Date().toISOString(),
            config: this.config
        };
    }
    
    // Calculate comprehensive statistics across all sources
    calculateComprehensiveStats(sourceStatistics, filteringStats) {
        const totals = {
            totalParsed: 0,
            validEvents: 0,
            invalidEvents: 0,
            bearEvents: 0,
            nonBearEvents: 0,
            pastEvents: 0,
            futureEvents: 0,
            eventsWithDates: 0,
            eventsWithoutDates: 0,
            processingErrors: 0,
            discardedEventsTotal: 0
        };
        
        const aggregatedData = {
            bearKeywordMatches: new Map(),
            venueDistribution: new Map(),
            cityDistribution: new Map(),
            eventStructures: new Map(),
            discardReasons: new Map(),
            sourcePerformance: []
        };
        
        // Aggregate statistics from all sources
        for (const sourceStat of sourceStatistics) {
            // Sum totals
            Object.keys(totals).forEach(key => {
                if (typeof sourceStat[key] === 'number') {
                    totals[key] += sourceStat[key];
                }
            });
            
            totals.processingErrors += sourceStat.processingErrors ? sourceStat.processingErrors.length : 0;
            totals.discardedEventsTotal += sourceStat.discardedEvents ? sourceStat.discardedEvents.length : 0;
            
            // Aggregate bear keyword matches
            if (sourceStat.bearKeywordMatches) {
                Object.entries(sourceStat.bearKeywordMatches).forEach(([keyword, count]) => {
                    aggregatedData.bearKeywordMatches.set(keyword, 
                        (aggregatedData.bearKeywordMatches.get(keyword) || 0) + count);
                });
            }
            
            // Aggregate venue distribution
            if (sourceStat.venueDistribution) {
                Object.entries(sourceStat.venueDistribution).forEach(([venue, count]) => {
                    aggregatedData.venueDistribution.set(venue, 
                        (aggregatedData.venueDistribution.get(venue) || 0) + count);
                });
            }
            
            // Aggregate city distribution
            if (sourceStat.cityDistribution) {
                Object.entries(sourceStat.cityDistribution).forEach(([city, count]) => {
                    aggregatedData.cityDistribution.set(city, 
                        (aggregatedData.cityDistribution.get(city) || 0) + count);
                });
            }
            
            // Aggregate event structures
            if (sourceStat.eventStructures) {
                Object.entries(sourceStat.eventStructures).forEach(([structure, count]) => {
                    aggregatedData.eventStructures.set(structure, 
                        (aggregatedData.eventStructures.get(structure) || 0) + count);
                });
            }
            
            // Track discard reasons
            if (sourceStat.discardedEvents) {
                sourceStat.discardedEvents.forEach(event => {
                    const reason = event.reason || 'Unknown';
                    aggregatedData.discardReasons.set(reason, 
                        (aggregatedData.discardReasons.get(reason) || 0) + 1);
                });
            }
            
            // Track source performance
            aggregatedData.sourcePerformance.push({
                source: sourceStat.source,
                url: sourceStat.url,
                totalParsed: sourceStat.totalParsed || 0,
                validEvents: sourceStat.validEvents || 0,
                bearEvents: sourceStat.bearEvents || 0,
                discardedEvents: sourceStat.discardedEvents ? sourceStat.discardedEvents.length : 0,
                successRate: sourceStat.totalParsed > 0 ? 
                    Math.round((sourceStat.validEvents / sourceStat.totalParsed) * 100) : 0,
                bearEventRate: sourceStat.validEvents > 0 ? 
                    Math.round((sourceStat.bearEvents / sourceStat.validEvents) * 100) : 0
            });
        }
        
        return {
            totals: {
                ...totals,
                ...filteringStats
            },
            bearKeywordMatches: Object.fromEntries(aggregatedData.bearKeywordMatches),
            venueDistribution: Object.fromEntries(aggregatedData.venueDistribution),
            cityDistribution: Object.fromEntries(aggregatedData.cityDistribution),
            eventStructures: Object.fromEntries(aggregatedData.eventStructures),
            discardReasons: Object.fromEntries(aggregatedData.discardReasons),
            sourcePerformance: aggregatedData.sourcePerformance,
            overallSuccessRate: totals.totalParsed > 0 ? 
                Math.round((totals.validEvents / totals.totalParsed) * 100) : 0,
            overallBearEventRate: totals.validEvents > 0 ? 
                Math.round((totals.bearEvents / totals.validEvents) * 100) : 0
        };
    }
    
    removeDuplicates(events) {
        const seen = new Set();
        return events.filter(event => {
            const key = `${event.title}-${event.date}-${event.venue}`.toLowerCase();
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }
    
    // Validate that we're using the actual downloaded modules
    validateModules() {
        const checks = [
            { name: 'InputAdapters', module: InputAdapters, expectedMethods: ['createInputAdapter'] },
            { name: 'EventProcessor', module: EventProcessor, isConstructor: true },
            { name: 'DisplayAdapters', module: DisplayAdapters, expectedMethods: ['createDisplayAdapter'] }
        ];
        
        for (const check of checks) {
            if (!check.module) {
                throw new Error(`${check.name} module not loaded`);
            }
            
            if (check.isConstructor && typeof check.module !== 'function') {
                throw new Error(`${check.name} is not a constructor function`);
            }
            
            if (check.expectedMethods) {
                for (const method of check.expectedMethods) {
                    if (typeof check.module[method] !== 'function') {
                        throw new Error(`${check.name} missing method: ${method}`);
                    }
                }
            }
        }
        
        console.log('✓ All modules validated - using actual downloaded libraries');
        return true;
    }
}

// Configuration is now required via scraper-input.json - no hardcoded fallbacks

// Load configuration from JSON file
async function loadConfiguration() {
    const isScriptable = typeof importModule !== 'undefined';
    
    try {
        if (isScriptable) {
            // Scriptable environment - use FileManager
            const fm = FileManager.iCloud();
            const configPath = fm.joinPath(fm.documentsDirectory(), 'scraper-input.json');
            
            if (fm.fileExists(configPath)) {
                const configData = fm.readString(configPath);
                return JSON.parse(configData);
            } else {
                throw new Error('❌ scraper-input.json not found in Scriptable documents directory. Place the file in: iCloud Drive/Scriptable/');
            }
        } else {
            // Web environment - try to fetch from same directory
            const response = await fetch('../scripts/scraper-input.json');
            if (response.ok) {
                return await response.json();
            } else {
                throw new Error('❌ scraper-input.json not found in scripts directory');
            }
        }
    } catch (error) {
        console.error('❌ Error loading configuration:', error.message || error);
        throw error;
    }
}

// Main execution function
async function main() {
    console.log('🐻 Starting Bear Event Scraper (Unified Version)');
    console.log('Using actual downloaded core modules for full end-to-end flow');
    
    // Load required configuration from JSON file
    const config = await loadConfiguration();
    console.log('✅ Loaded configuration from scraper-input.json');
    
    if (!config.parsers || config.parsers.length === 0) {
        throw new Error('❌ No parsers found in configuration file');
    }
    
    const sources = config.parsers;
    const scraperConfig = { dryRun: true, ...config.config };
    console.log(`📋 Found ${sources.length} configured parsers`);
    
    const scraper = new BearEventScraper(scraperConfig);
    
    try {
        // Validate we're using the real modules
        await scraper.initialize();
        scraper.validateModules();
        
        const results = await scraper.scrapeEvents(sources);
        console.log('🎉 Scraping completed successfully!')
        console.log(`📊 Final Results: ${results.events.length} events (${results.bearEventCount} bear events) from ${results.successfulSources}/${results.totalSources} sources`)
        
        // Log comprehensive statistics if available
        if (results.comprehensiveStats) {
            const stats = results.comprehensiveStats;
            console.log('\n📈 Comprehensive Statistics:');
            console.log(`   Total Events Found: ${stats.totals.totalEventsFound}`);
            console.log(`   Processing Success Rate: ${stats.overallSuccessRate}%`);
            console.log(`   Bear Event Rate: ${stats.overallBearEventRate}%`);
            console.log(`   Duplicates Removed: ${stats.totals.duplicatesRemoved}`);
            console.log(`   Past Events Filtered: ${stats.totals.pastEventsFiltered}`);
            console.log(`   Total Discarded: ${stats.totals.discardedEventsTotal}`);
            
            // Log source performance
            if (stats.sourcePerformance && stats.sourcePerformance.length > 0) {
                console.log('\n🔍 Source Performance:');
                stats.sourcePerformance.forEach(source => {
                    console.log(`   ${source.source}: ${source.validEvents}/${source.totalParsed} events (${source.successRate}% success, ${source.bearEventRate}% bear)`);
                });
            }
            
            // Log top bear keywords
            if (stats.bearKeywordMatches && Object.keys(stats.bearKeywordMatches).length > 0) {
                console.log('\n🐻 Top Bear Keywords:');
                const topKeywords = Object.entries(stats.bearKeywordMatches)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5);
                topKeywords.forEach(([keyword, count]) => {
                    console.log(`   "${keyword}": ${count} matches`);
                });
            }
            
            // Log discard reasons
            if (stats.discardReasons && Object.keys(stats.discardReasons).length > 0) {
                console.log('\n🗑️ Discard Reasons:');
                Object.entries(stats.discardReasons).forEach(([reason, count]) => {
                    console.log(`   ${reason}: ${count} events`);
                });
            }
        }
        
        return results;
    } catch (error) {
        console.error('💥 Scraping failed:', error);
        
        // Show error in appropriate format
        const isScriptable = typeof importModule !== 'undefined';
        if (isScriptable) {
            const alert = new Alert();
            alert.title = "Bear Event Scraper Error";
            alert.message = `Failed to complete scraping: ${error.message}`;
            alert.addAction("OK");
            await alert.presentAlert();
        }
        
        throw error;
    }
}

// Auto-run if this is the main script
if (typeof importModule !== 'undefined') {
    // Scriptable environment - auto-run
    main().catch(console.error);
} else if (typeof window !== 'undefined' && window.document) {
    // Web environment - just expose functions, don't auto-run
    window.BearEventScraper = BearEventScraper;
    window.runBearEventScraper = main;
    window.runWithConfig = runWithConfig;
    window.loadConfiguration = loadConfiguration;
    
    console.log('🌐 Bear Event Scraper loaded for web environment');
    console.log('Available classes:', {
        BearEventScraper: typeof BearEventScraper !== 'undefined',
        InputAdapters: typeof InputAdapters !== 'undefined',
        EventProcessor: typeof EventProcessor !== 'undefined',
        DisplayAdapters: typeof DisplayAdapters !== 'undefined'
    });
}

// Helper function to run with custom configuration
async function runWithConfig(customConfig = {}) {
    console.log('🐻 Starting Bear Event Scraper with custom configuration');
    
    const scraper = new BearEventScraper(customConfig);
    
    try {
        await scraper.initialize();
        scraper.validateModules();
        
        // Use custom sources if provided, otherwise load from required JSON config
        let sources;
        
        if (customConfig.sources) {
            sources = customConfig.sources;
            console.log(`✅ Using ${sources.length} custom sources`);
        } else {
            const config = await loadConfiguration();
            if (!config.parsers || config.parsers.length === 0) {
                throw new Error('❌ No parsers found in configuration file');
            }
            sources = config.parsers;
            console.log(`✅ Using ${sources.length} parsers from scraper-input.json`);
        }
        
        const results = await scraper.scrapeEvents(sources);
        console.log('\n🎉 Scraping completed successfully!');
        console.log(`📊 Final Results: ${results.events.length} events (${results.bearEventCount} bear events) from ${results.successfulSources}/${results.totalSources} sources`);
        
        return results;
    } catch (error) {
        console.error('💥 Scraping failed:', error);
        throw error;
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BearEventScraper, main, runWithConfig, loadConfiguration };
    // Also expose globally for testing
    if (typeof global !== 'undefined') {
        global.BearEventScraper = BearEventScraper;
        global.runWithConfig = runWithConfig;
    }
}
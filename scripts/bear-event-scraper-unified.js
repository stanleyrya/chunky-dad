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
        this.config = {
            dryRun: true,
            preview: true,
            mockMode: false,
            maxEvents: 50,
            enableDebugMode: true,
            daysToLookAhead: 90,
            ...config
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
            
            this.isInitialized = true;
            console.log('✓ Bear Event Scraper initialized successfully');
            
            // Log environment info
            const env = typeof importModule !== 'undefined' ? 'Scriptable' : 'Web';
            console.log(`Environment: ${env}`);
            console.log(`Mock Mode: ${this.config.mockMode}`);
            console.log(`Max Events: ${this.config.maxEvents}`);
            console.log(`Days to Look Ahead: ${this.config.daysToLookAhead}`);
            
        } catch (error) {
            console.error('✗ Failed to initialize Bear Event Scraper:', error);
            throw error;
        }
    }
    
    async scrapeEvents(sources) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        console.log(`Starting to scrape ${sources.length} sources...`);
        const results = [];
        
        for (const source of sources) {
            console.log(`Processing: ${source.name}`);
            
            try {
                // 1. Input - Fetch data using the actual InputAdapter
                console.log(`  → Fetching data from ${source.url}`);
                const rawData = await this.inputAdapter.fetchData({
                    url: source.url,
                    parser: source.parser,
                    mockMode: this.config.mockMode,
                    timeout: 10000 // 10 second timeout
                });
                
                if (rawData.error) {
                    console.error(`  ✗ Error fetching ${source.name}: ${rawData.error}`);
                    continue;
                }
                
                console.log(`  ✓ Fetched ${rawData.html ? rawData.html.length : 0} characters of HTML`);
                if (rawData.mock) {
                    console.log('  ℹ Using mock data for testing');
                }
                
                // 2. Processing - Parse and standardize using the actual EventProcessor
                console.log(`  → Processing events with ${source.parser} parser`);
                const processedResult = await this.processor.processEvents(rawData, source);
                
                if (processedResult.success) {
                    results.push(processedResult);
                    const bearCount = processedResult.events.filter(e => e.isBearEvent).length;
                    console.log(`  ✓ ${source.name}: ${processedResult.events.length} events found (${bearCount} bear events)`);
                } else {
                    console.error(`  ✗ ${source.name}: ${processedResult.error}`);
                }
                
            } catch (error) {
                console.error(`  ✗ Error processing ${source.name}:`, error);
            }
        }
        
        // Combine all results
        const combinedResult = this.combineResults(results);
        console.log(`✓ Scraping completed: ${combinedResult.events.length} total events from ${combinedResult.totalSources} sources`);
        
        // 3. Display - Show results using the actual DisplayAdapter
        try {
            await this.displayAdapter.displayResults(combinedResult, {
                format: this.config.displayFormat || 'default'
            });
        } catch (error) {
            console.error('Error displaying results:', error);
        }
        
        return combinedResult;
    }
    
    combineResults(results) {
        const allEvents = [];
        const sources = [];
        let successfulSources = 0;
        
        for (const result of results) {
            if (result.success) {
                allEvents.push(...result.events);
                sources.push(result.source);
                successfulSources++;
            }
        }
        
        // Remove duplicates based on title and date
        const uniqueEvents = this.removeDuplicates(allEvents);
        
        // Sort by date (upcoming events first)
        uniqueEvents.sort((a, b) => {
            if (!a.date && !b.date) return 0;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return new Date(a.date) - new Date(b.date);
        });
        
        return {
            success: true,
            events: uniqueEvents,
            sources: sources,
            totalSources: results.length,
            successfulSources: successfulSources,
            bearEventCount: uniqueEvents.filter(e => e.isBearEvent).length,
            timestamp: new Date().toISOString(),
            config: this.config
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

// Configuration for different sources
const DEFAULT_SOURCES = [
    {
        name: "Furball NYC",
        parser: "furball",
        url: "https://www.furball.nyc",
        alwaysBear: true,
        defaultCity: "nyc",
        defaultVenue: "Various"
    },
    {
        name: "Rockbar NYC",
        parser: "rockbar",
        url: "https://www.rockbarnyc.com/calendar",
        allowlist: ["rockstrap", "underbear", "bear happy hour"],
        defaultCity: "nyc",
        defaultVenue: "Rockbar"
    },
    {
        name: "SF Eagle",
        parser: "sf-eagle",
        url: "https://www.sf-eagle.com/events",
        allowlist: ["bear", "cub", "otter", "leather bears"],
        defaultCity: "sf",
        defaultVenue: "SF Eagle"
    }
];

// Main execution function
async function main() {
    console.log('🐻 Starting Bear Event Scraper (Unified Version)');
    console.log('Using actual downloaded core modules for full end-to-end flow');
    
    const scraper = new BearEventScraper({
        mockMode: true, // Set to false for real scraping
        dryRun: true,
        maxEvents: 50,
        enableDebugMode: true
    });
    
    try {
        // Validate we're using the real modules
        await scraper.initialize();
        scraper.validateModules();
        
        const results = await scraper.scrapeEvents(DEFAULT_SOURCES);
        console.log('\n🎉 Scraping completed successfully!');
        console.log(`📊 Final Results: ${results.events.length} events (${results.bearEventCount} bear events) from ${results.successfulSources}/${results.totalSources} sources`);
        
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
    // Scriptable environment
    main().catch(console.error);
} else if (typeof window !== 'undefined' && window.document) {
    // Web environment - expose BearEventScraper immediately
    window.BearEventScraper = BearEventScraper;
    window.runBearEventScraper = main;
    
    console.log('🌐 Bear Event Scraper loaded for web environment');
    console.log('Use runBearEventScraper() to execute or create new BearEventScraper() instance');
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BearEventScraper, main, DEFAULT_SOURCES };
    // Also expose globally for testing
    if (typeof global !== 'undefined') {
        global.BearEventScraper = BearEventScraper;
    }
}
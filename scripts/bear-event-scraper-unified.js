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
            const inputModule = importModule('core/input-adapters');
            const processorModule = importModule('core/event-processor');
            const displayModule = importModule('core/display-adapters');
            
            InputAdapters = inputModule;
            EventProcessor = processorModule.EventProcessor;
            DisplayAdapters = displayModule;
        } catch (error) {
            // Fallback: load inline versions if modules not found
            console.log('Loading inline modules for Scriptable');
            await loadInlineModules();
        }
    } else {
        // Web environment - modules should be loaded via script tags
        if (typeof window !== 'undefined') {
            InputAdapters = window.InputAdapters;
            EventProcessor = window.EventProcessor;
            DisplayAdapters = window.DisplayAdapters;
        }
        
        // If modules not loaded, load them dynamically
        if (!InputAdapters || !EventProcessor || !DisplayAdapters) {
            console.log('Loading inline modules for web');
            await loadInlineModules();
        }
    }
}

async function loadInlineModules() {
    // This would contain the inline versions of the modules
    // For now, we'll use simplified versions
    
    // Simplified Input Adapter
    class SimpleInputAdapter {
        constructor() {
            this.isScriptable = typeof importModule !== 'undefined';
        }
        
        async fetchData(config) {
            if (config.mockMode || !this.isScriptable) {
                return {
                    url: config.url,
                    html: this.getMockHTML(config.parser),
                    status: 200,
                    timestamp: new Date().toISOString(),
                    mock: true
                };
            }
            
            // Scriptable fetch
            try {
                const request = new Request(config.url);
                const html = await request.loadString();
                return {
                    url: config.url,
                    html: html,
                    status: 200,
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                return {
                    url: config.url,
                    error: error.message,
                    timestamp: new Date().toISOString()
                };
            }
        }
        
        getMockHTML(parser) {
            const mockData = {
                'furball': '<div class="event"><h3>Furball Dance Party</h3><time>2025-02-15</time></div>',
                'rockbar': '<div class="event-item"><h2>Rockstrap Night</h2><span class="date">Feb 20, 2025</span></div>',
                'sf-eagle': '<div class="event"><h4>Bear Happy Hour</h4><div class="date">March 1, 2025</div></div>'
            };
            return `<html><body>${mockData[parser] || mockData['furball']}</body></html>`;
        }
    }
    
    // Simplified Event Processor (inline version of the full module)
    class SimpleEventProcessor {
        constructor(config = {}) {
            this.config = config;
            this.bearKeywords = ['bear', 'bears', 'cub', 'cubs', 'otter', 'rockstrap', 'underbear', 'furball'];
        }
        
        async processEvents(rawData, parserConfig) {
            const events = [];
            
            try {
                const parsedEvents = this.parseHTML(rawData.html, parserConfig);
                
                for (const eventData of parsedEvents) {
                    const processedEvent = {
                        title: eventData.title,
                        date: eventData.date,
                        venue: eventData.venue || parserConfig.defaultVenue,
                        city: eventData.city || parserConfig.defaultCity,
                        source: parserConfig.name,
                        isBearEvent: this.isBearEvent(eventData, parserConfig)
                    };
                    
                    if (processedEvent.title) {
                        events.push(processedEvent);
                    }
                }
                
                return {
                    success: true,
                    events: events,
                    source: parserConfig.name,
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                return {
                    success: false,
                    error: error.message,
                    source: parserConfig.name,
                    timestamp: new Date().toISOString()
                };
            }
        }
        
        parseHTML(html, parserConfig) {
            const events = [];
            const eventPattern = /<div[^>]*class="[^"]*event[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
            const matches = html.match(eventPattern) || [];
            
            for (const match of matches) {
                const titleMatch = match.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
                const dateMatch = match.match(/<time[^>]*>([^<]+)<\/time>/i) || 
                                match.match(/<span[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)<\/span>/i) ||
                                match.match(/<div[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)<\/div>/i);
                
                if (titleMatch) {
                    events.push({
                        title: titleMatch[1].trim(),
                        date: dateMatch ? dateMatch[1].trim() : null,
                        venue: parserConfig.defaultVenue,
                        city: parserConfig.defaultCity
                    });
                }
            }
            
            return events;
        }
        
        isBearEvent(eventData, parserConfig) {
            if (parserConfig.alwaysBear) return true;
            
            const text = (eventData.title || '').toLowerCase();
            return this.bearKeywords.some(keyword => text.includes(keyword));
        }
    }
    
    // Simplified Display Adapter
    class SimpleDisplayAdapter {
        constructor() {
            this.isScriptable = typeof importModule !== 'undefined';
        }
        
        async displayResults(results, config = {}) {
            if (this.isScriptable) {
                return this.displayScriptable(results);
            } else {
                return this.displayWeb(results);
            }
        }
        
        async displayScriptable(results) {
            const eventCount = results.events ? results.events.length : 0;
            const bearEventCount = results.events ? 
                results.events.filter(e => e.isBearEvent).length : 0;
            
            const alert = new Alert();
            alert.title = "Bear Event Scraper";
            alert.message = `Found ${eventCount} events (${bearEventCount} bear events) from ${results.source}`;
            alert.addAction("OK");
            
            await alert.presentAlert();
            
            // Also log to console
            console.log(`\nBear Event Scraper Results:`);
            console.log(`Source: ${results.source}`);
            console.log(`Total Events: ${eventCount}`);
            console.log(`Bear Events: ${bearEventCount}`);
            
            if (results.events) {
                results.events.forEach((event, index) => {
                    console.log(`\n${index + 1}. ${event.title} ${event.isBearEvent ? '🐻' : ''}`);
                    console.log(`   Date: ${event.date || 'TBD'}`);
                    console.log(`   Venue: ${event.venue || 'N/A'}`);
                });
            }
            
            return { text: alert.message };
        }
        
        displayWeb(results) {
            const output = document.createElement('div');
            output.style.cssText = 'font-family: Arial, sans-serif; max-width: 800px; margin: 20px auto; padding: 20px;';
            
            const header = document.createElement('h2');
            header.textContent = 'Bear Event Scraper Results';
            output.appendChild(header);
            
            const eventCount = results.events ? results.events.length : 0;
            const bearEventCount = results.events ? 
                results.events.filter(e => e.isBearEvent).length : 0;
            
            const summary = document.createElement('div');
            summary.innerHTML = `
                <p><strong>Source:</strong> ${results.source}</p>
                <p><strong>Total Events:</strong> ${eventCount}</p>
                <p><strong>Bear Events:</strong> ${bearEventCount}</p>
            `;
            output.appendChild(summary);
            
            if (results.events && results.events.length > 0) {
                results.events.forEach(event => {
                    const eventDiv = document.createElement('div');
                    eventDiv.style.cssText = `
                        border: 1px solid ${event.isBearEvent ? '#4CAF50' : '#ddd'};
                        margin: 10px 0;
                        padding: 15px;
                        background: ${event.isBearEvent ? '#f8fff8' : '#fff'};
                    `;
                    
                    eventDiv.innerHTML = `
                        <h3>${event.title} ${event.isBearEvent ? '🐻' : ''}</h3>
                        <p><strong>Date:</strong> ${event.date || 'TBD'}</p>
                        <p><strong>Venue:</strong> ${event.venue || 'N/A'}</p>
                        <p><strong>City:</strong> ${event.city || 'N/A'}</p>
                    `;
                    output.appendChild(eventDiv);
                });
            }
            
            return { element: output };
        }
    }
    
    // Set up the simplified modules
    InputAdapters = { createInputAdapter: () => new SimpleInputAdapter() };
    EventProcessor = SimpleEventProcessor;
    DisplayAdapters = { createDisplayAdapter: () => new SimpleDisplayAdapter() };
}

// Main Bear Event Scraper Class
class BearEventScraper {
    constructor(config = {}) {
        this.config = {
            dryRun: true,
            preview: true,
            mockMode: false,
            maxEvents: 50,
            ...config
        };
        
        this.inputAdapter = null;
        this.processor = null;
        this.displayAdapter = null;
    }
    
    async initialize() {
        await loadModules();
        
        this.inputAdapter = InputAdapters.createInputAdapter();
        this.processor = new EventProcessor(this.config);
        this.displayAdapter = DisplayAdapters.createDisplayAdapter();
        
        console.log('Bear Event Scraper initialized');
    }
    
    async scrapeEvents(sources) {
        if (!this.inputAdapter) {
            await this.initialize();
        }
        
        const results = [];
        
        for (const source of sources) {
            console.log(`Processing: ${source.name}`);
            
            try {
                // 1. Input - Fetch data
                const rawData = await this.inputAdapter.fetchData({
                    url: source.url,
                    parser: source.parser,
                    mockMode: this.config.mockMode
                });
                
                if (rawData.error) {
                    console.error(`Error fetching ${source.name}: ${rawData.error}`);
                    continue;
                }
                
                // 2. Processing - Parse and standardize
                const processedResult = await this.processor.processEvents(rawData, source);
                
                if (processedResult.success) {
                    results.push(processedResult);
                    console.log(`✓ ${source.name}: ${processedResult.events.length} events found`);
                } else {
                    console.error(`✗ ${source.name}: ${processedResult.error}`);
                }
                
            } catch (error) {
                console.error(`Error processing ${source.name}:`, error);
            }
        }
        
        // Combine all results
        const combinedResult = this.combineResults(results);
        
        // 3. Display - Show results
        await this.displayAdapter.displayResults(combinedResult, {
            format: this.config.displayFormat || 'default'
        });
        
        return combinedResult;
    }
    
    combineResults(results) {
        const allEvents = [];
        const sources = [];
        
        for (const result of results) {
            allEvents.push(...result.events);
            sources.push(result.source);
        }
        
        // Remove duplicates based on title and date
        const uniqueEvents = this.removeDuplicates(allEvents);
        
        return {
            success: true,
            events: uniqueEvents,
            sources: sources,
            totalSources: results.length,
            timestamp: new Date().toISOString()
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
    console.log('Starting Bear Event Scraper (Unified Version)');
    
    const scraper = new BearEventScraper({
        mockMode: true, // Set to false for real scraping
        dryRun: true,
        maxEvents: 50
    });
    
    try {
        const results = await scraper.scrapeEvents(DEFAULT_SOURCES);
        console.log('\nScraping completed successfully!');
        return results;
    } catch (error) {
        console.error('Scraping failed:', error);
        
        // Show error in appropriate format
        const isScriptable = typeof importModule !== 'undefined';
        if (isScriptable) {
            const alert = new Alert();
            alert.title = "Scraping Error";
            alert.message = error.message;
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
    // Web environment - load modules and expose functions globally
    loadModules().then(() => {
        window.BearEventScraper = BearEventScraper;
        window.runBearEventScraper = main;
        
        // Auto-run if page is loaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                console.log('Bear Event Scraper loaded. Call runBearEventScraper() to start.');
            });
        } else {
            console.log('Bear Event Scraper loaded. Call runBearEventScraper() to start.');
        }
    }).catch(error => {
        console.error('Failed to load Bear Event Scraper modules:', error);
    });
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BearEventScraper, main, DEFAULT_SOURCES };
}
// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: laptop-code;
// 
// ============================================================================
// BEAR EVENT SCRAPER - LIGHTWEIGHT ORCHESTRATOR
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file is a LIGHTWEIGHT ORCHESTRATOR only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Environment detection (Scriptable vs Web)
// ✅ Module loading and coordination
// ✅ Configuration management
// ✅ Error handling and user feedback
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Business logic (that belongs in shared-core.js)
// ❌ Parsing logic (that belongs in parsers/)
// ❌ HTTP requests (that belongs in adapters/)
// ❌ Calendar operations (that belongs in adapters/)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

console.log('🐻 Bear Event Scraper - Unified Version Starting...');

class BearEventScraperOrchestrator {
    constructor() {
        this.isScriptable = typeof importModule !== 'undefined';
        this.isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
        this.isWeb = typeof window !== 'undefined';
        this.isInitialized = false;
        this.modules = {};
    }

    async initialize() {
        if (this.isInitialized) {
            console.log('🐻 Orchestrator: Already initialized');
            return;
        }

        try {
            const envName = this.isScriptable ? 'Scriptable' : this.isNode ? 'Node.js' : 'Web';
            console.log(`🐻 Orchestrator: Initializing for ${envName} environment`);
            
            // Load modules based on environment
            await this.loadModules();
            
            this.isInitialized = true;
        } catch (error) {
            console.error(`🐻 Orchestrator: ✗ Initialization failed: ${error}`);
            throw new Error(`Initialization failed: ${error.message}`);
        }
    }

    async loadModules() {
        if (this.isScriptable) {
            await this.loadScriptableModules();
        } else if (this.isNode) {
            await this.loadNodeModules();
        } else {
            await this.loadWebModules();
        }
    }

    async loadScriptableModules() {
        try {
            console.log('📱 Loading Scriptable modules...');
            
            // Load core modules
            const sharedCoreModule = importModule('shared-core');
            const scriptableAdapterModule = importModule('adapters/scriptable-adapter');
            
            // Load parsers
            const eventbriteParserModule = importModule('parsers/eventbrite-parser');
            const bearracudaParserModule = importModule('parsers/bearracuda-parser');
            const genericParserModule = importModule('parsers/generic-parser');
            const chunkParserModule = importModule('parsers/chunk-parser');
            const furballParserModule = importModule('parsers/furball-parser');
            const bearsSitgesParserModule = importModule('parsers/bears-sitges-parser');
            const linktreeParserModule = importModule('parsers/linktree-parser');
            const redeyeticketsParserModule = importModule('parsers/redeyetickets-parser');
            
            // Store modules
            this.modules = {
                SharedCore: sharedCoreModule.SharedCore,
                adapter: scriptableAdapterModule.ScriptableAdapter,
                parsers: {
                    eventbrite: eventbriteParserModule.EventbriteParser,
                    bearracuda: bearracudaParserModule.BearraccudaParser,
                    generic: genericParserModule.GenericParser,
                    chunk: chunkParserModule.ChunkParser,
                    furball: furballParserModule.FurballParser,
                    'bears-sitges': bearsSitgesParserModule.BearsSitgesParser,
                    linktree: linktreeParserModule.LinktreeParser,
                    redeyetickets: redeyeticketsParserModule.RedEyeTicketsParser
                }
            };
        } catch (error) {
            console.error(`📱 ✗ Failed to load Scriptable modules: ${error}`);
            throw new Error(`Scriptable module loading failed: ${error.message}`);
        }
    }

    async loadNodeModules() {
        try {
            console.log('🟢 Loading Node.js modules...');
            
            // Load core modules using require
            const sharedCoreModule = require('./shared-core');
            const webAdapterModule = require('./adapters/web-adapter');
            
            // Load parsers
            const eventbriteParserModule = require('./parsers/eventbrite-parser');
            const bearracudaParserModule = require('./parsers/bearracuda-parser');
            const genericParserModule = require('./parsers/generic-parser');
            const chunkParserModule = require('./parsers/chunk-parser');
            const furballParserModule = require('./parsers/furball-parser');
            const bearsSitgesParserModule = require('./parsers/bears-sitges-parser');
            const linktreeParserModule = require('./parsers/linktree-parser');
            const redeyeticketsParserModule = require('./parsers/redeyetickets-parser');
            
            // Store modules
            this.modules = {
                SharedCore: sharedCoreModule.SharedCore,
                adapter: webAdapterModule.WebAdapter,
                parsers: {
                    eventbrite: eventbriteParserModule.EventbriteParser,
                    bearracuda: bearracudaParserModule.BearraccudaParser,
                    generic: genericParserModule.GenericParser,
                    chunk: chunkParserModule.ChunkParser,
                    furball: furballParserModule.FurballParser,
                    'bears-sitges': bearsSitgesParserModule.BearsSitgesParser,
                    linktree: linktreeParserModule.LinktreeParser,
                    redeyetickets: redeyeticketsParserModule.RedEyeTicketsParser
                }
            };
        } catch (error) {
            console.error(`🟢 ✗ Failed to load Node.js modules: ${error}`);
            throw new Error(`Node.js module loading failed: ${error.message}`);
        }
    }

    async loadWebModules() {
        try {
            console.log('🌐 Loading web modules...');
            
            // Check if modules are available (should be loaded via script tags)
            const requiredModules = [
                'SharedCore', 'WebAdapter', 
                'EventbriteParser', 'BearraccudaParser', 'GenericParser', 'ChunkParser', 'FurballParser', 'BearsSitgesParser', 'LinktreeParser', 'RedEyeTicketsParser'
            ];
            
            const missingModules = requiredModules.filter(module => !window[module]);
            
            if (missingModules.length > 0) {
                throw new Error(`Missing web modules: ${missingModules.join(', ')}. Ensure all files are loaded via script tags.`);
            }
            
            // Store modules
            this.modules = {
                SharedCore: window.SharedCore,
                adapter: window.WebAdapter,
                parsers: {
                    eventbrite: window.EventbriteParser,
                    bearracuda: window.BearraccudaParser,
                    generic: window.GenericParser,
                    chunk: window.ChunkParser,
                    furball: window.FurballParser,
                    'bears-sitges': window.BearsSitgesParser,
                    linktree: window.LinktreeParser,
                    redeyetickets: window.RedEyeTicketsParser
                }
            };
        } catch (error) {
            console.error(`🌐 ✗ Failed to load web modules: ${error}`);
            throw new Error(`Web module loading failed: ${error.message}`);
        }
    }

    async run() {
        try {
            // Initialize if not already done
            if (!this.isInitialized) {
                console.log('🐻 Orchestrator: Not initialized, initializing now...');
                await this.initialize();
            }

            // Create adapter instance first
            const adapter = new this.modules.adapter();
            
            // Load configuration early so we can pass cities config to SharedCore
            const config = await adapter.loadConfiguration();
            
            // Create shared core instance with cities configuration
            const sharedCore = new this.modules.SharedCore(config.cities);
            
            // Create adapter with cities configuration - always create new instance with cities
            const finalAdapter = new this.modules.adapter({
                cities: config.cities,
                ...this.config
            });

            // Create parser instances
            const parsers = {};
            for (const [name, ParserClass] of Object.entries(this.modules.parsers)) {
                try {
                    parsers[name] = new ParserClass();
                } catch (error) {
                    console.error(`🐻 Orchestrator: ✗ Failed to create ${name} parser: ${error}`);
                    throw new Error(`Failed to create ${name} parser: ${error.message}`);
                }
            }

            // Process events using shared core
            const results = await sharedCore.processEvents(config, finalAdapter, finalAdapter, parsers);
            console.log('🐻 Orchestrator: ✓ Event processing completed');
            
            // Add to calendar if not dry run and we have events
            if (results.allProcessedEvents && results.allProcessedEvents.length > 0) {
                console.log(`🐻 Orchestrator: Processing ${results.allProcessedEvents.length} events for calendar...`);
                
                let calendarEvents = 0;
                
                // Check if we should add to calendar
                const isDryRun = config.config.dryRun;
                
                // Always prepare events for analysis (even in dry run mode) to show action types
                console.log('🐻 Orchestrator: Analyzing events for calendar actions...');
                
                // Perform cross-parser deduplication to merge events from different parsers
                console.log(`🐻 Orchestrator: Performing cross-parser deduplication on ${results.allProcessedEvents.length} events...`);
                const deduplicatedEvents = sharedCore.deduplicateEvents(results.allProcessedEvents);
                console.log(`🐻 Orchestrator: ✓ After cross-parser deduplication: ${deduplicatedEvents.length} unique events`);
                
                const analyzedEvents = await sharedCore.prepareEventsForCalendar(deduplicatedEvents, finalAdapter, config.config);
                console.log(`🐻 Orchestrator: ✓ Analyzed ${analyzedEvents.length} events for calendar actions`);
                
                // Store analyzed events back into results for display
                results.analyzedEvents = analyzedEvents;
                
                // Update totals to reflect cross-parser deduplication
                results.deduplicatedEvents = deduplicatedEvents.length;

                // Determine execution mode based on environment
                const hasDisplay = this.isScriptable || this.isWeb;
                const isWidget = this.isScriptable && config.widgetParameter;
                
                if (!isDryRun && typeof finalAdapter.executeCalendarActions === 'function' && analyzedEvents) {
                    if (hasDisplay && !isWidget) {
                        // If we have a display (not widget), show results first and let user decide
                        console.log('🐻 Orchestrator: Display mode - showing results before execution');
                        // The display will handle the execution decision
                    } else {
                        // No display (widget mode) or explicit execution requested
                        console.log('🐻 Orchestrator: Auto-execution mode - processing calendar actions');
                        try {
                            calendarEvents = await finalAdapter.executeCalendarActions(analyzedEvents, config);
                            console.log(`🐻 Orchestrator: ✓ Processed ${calendarEvents} events to calendar`);
                        } catch (error) {
                            console.error(`🐻 Orchestrator: ✗ Failed to process events to calendar: ${error.message}`);
                            results.errors.push(`Calendar processing failed: ${error.message}`);
                        }
                    }
                } else {
                    console.log('🐻 Orchestrator: Dry run mode or calendar not supported - skipping calendar integration');
                }
                
            // Add calendar count and config to results
            results.calendarEvents = calendarEvents;
            results.config = config;
            }

            // Display results
            console.log('🐻 Orchestrator: Displaying results...');
            await finalAdapter.displayResults(results);

            console.log('🐻 Orchestrator: ✓ Event scraping completed successfully');
            return results;

        } catch (error) {
            console.error(`🐻 Orchestrator: ✗ Event scraping failed: ${error}`);
            
            // Only log error details if they exist and are meaningful
            if (error.stack && error.stack.trim()) {
                console.error(`🐻 Orchestrator: ✗ Error stack trace: ${error.stack}`);
            }
            if (error.name && error.name.trim()) {
                console.error(`🐻 Orchestrator: ✗ Error name: ${error.name}`);
            }
            if (error.message && error.message.trim()) {
                console.error(`🐻 Orchestrator: ✗ Error message: ${error.message}`);
            }
            
            // Try to show user-friendly error
            if (this.modules?.adapter) {
                try {
                    // Create adapter with minimal config for error display
                    const adapter = new this.modules.adapter({ cities: {} });
                    const errorName = error.name || 'Unknown Error';
                    const errorMessage = error.message || 'An unexpected error occurred';
                    await adapter.showError('Bear Event Scraper Error', `${errorName}: ${errorMessage}\n\nCheck console for full details.`);
                            } catch (displayError) {
                console.error(`🐻 Orchestrator: ✗ Failed to show error dialog: ${displayError}`);
            }
            }
            
            throw error;
        }
    }

    // Static method for easy execution
    static async execute() {
        const orchestrator = new BearEventScraperOrchestrator();
        return await orchestrator.run();
    }
}

// Auto-execute when loaded
(async () => {
    try {
        console.log('🐻 Bear Event Scraper: Auto-executing...');
        const results = await BearEventScraperOrchestrator.execute();
        console.log('🐻 Bear Event Scraper: Execution completed successfully');
    } catch (error) {
    console.error(`🐻 Bear Event Scraper: Execution failed: ${error}`);
}
})();

// Export for manual execution if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BearEventScraperOrchestrator };
} else if (typeof window !== 'undefined') {
    window.BearEventScraperOrchestrator = BearEventScraperOrchestrator;
} else {
    // Scriptable environment
    this.BearEventScraperOrchestrator = BearEventScraperOrchestrator;
}

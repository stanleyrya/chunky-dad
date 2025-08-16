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
            console.log('🐻 Orchestrator: ✓ Initialization complete');
            
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
            
            // Store modules
            this.modules = {
                SharedCore: sharedCoreModule.SharedCore,
                adapter: scriptableAdapterModule.ScriptableAdapter,
                parsers: {
                    eventbrite: eventbriteParserModule.EventbriteParser,
                    bearracuda: bearracudaParserModule.BearraccudaParser,
                    generic: genericParserModule.GenericParser
                }
            };
            
            console.log('📱 ✓ Scriptable modules loaded successfully');
            
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
            
            // Store modules
            this.modules = {
                SharedCore: sharedCoreModule.SharedCore,
                adapter: webAdapterModule.WebAdapter,
                parsers: {
                    eventbrite: eventbriteParserModule.EventbriteParser,
                    bearracuda: bearracudaParserModule.BearraccudaParser,
                    generic: genericParserModule.GenericParser
                }
            };
            
            console.log('🟢 ✓ Node.js modules loaded successfully');
            
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
                'EventbriteParser', 'BearraccudaParser', 'GenericParser'
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
                    generic: window.GenericParser
                }
            };
            
            console.log('🌐 ✓ Web modules loaded successfully');
            
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

            console.log('🐻 Orchestrator: Starting event scraping process...');

            // Create shared core instance first
            console.log('🐻 Orchestrator: Creating shared core instance...');
            const sharedCore = new this.modules.SharedCore();
            console.log('🐻 Orchestrator: ✓ Shared core instance created');

            // Create adapter instance
            console.log('🐻 Orchestrator: Creating adapter instance...');
            const adapter = new this.modules.adapter();
            console.log('🐻 Orchestrator: ✓ Adapter instance created');
            
            // Load configuration
            console.log('🐻 Orchestrator: Loading configuration...');
            const config = await adapter.loadConfiguration();
            console.log(`🐻 Orchestrator: ✓ Configuration loaded with ${config.parsers?.length || 0} parsers`);
            
            // Create adapter with calendar mappings if available
            let finalAdapter = adapter;
            if (config.calendarMappings) {
                console.log('🐻 Orchestrator: Creating adapter with calendar mappings...');
                finalAdapter = new this.modules.adapter({
                    calendarMappings: config.calendarMappings,
                    ...this.config
                });
                console.log('🐻 Orchestrator: ✓ Adapter with calendar mappings created');
            }

            // Log configuration details
            if (config.parsers) {
                config.parsers.forEach((parser, i) => {
                    console.log(`🐻 Orchestrator: Parser ${i + 1}: ${parser.name} (${parser.parser})`);
                });
            }

            // Create parser instances
            console.log('🐻 Orchestrator: Creating parser instances...');
            const parsers = {};
            for (const [name, ParserClass] of Object.entries(this.modules.parsers)) {
                try {
                    parsers[name] = new ParserClass();
                    console.log(`🐻 Orchestrator: ✓ Created ${name} parser`);
                } catch (error) {
                    console.error(`🐻 Orchestrator: ✗ Failed to create ${name} parser: ${error}`);
                    throw new Error(`Failed to create ${name} parser: ${error.message}`);
                }
            }

            console.log(`🐻 Orchestrator: ✓ Created ${Object.keys(parsers).length} parser instances: ${Object.keys(parsers).join(', ')}`);
            
            // Parsers are now pure and don't need shared-core initialization
            console.log('🐻 Orchestrator: Parsers are pure - no initialization needed');

            // Process events using shared core
            console.log('🐻 Orchestrator: Calling sharedCore.processEvents...');
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
                
                const analyzedEvents = await sharedCore.prepareEventsForCalendar(results.allProcessedEvents, finalAdapter, config.config);
                console.log(`🐻 Orchestrator: ✓ Analyzed ${analyzedEvents.length} events for calendar actions`);
                
                // Store analyzed events back into results for display
                results.analyzedEvents = analyzedEvents;

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
                    const adapter = new this.modules.adapter();
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


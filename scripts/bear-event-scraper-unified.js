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
        this.isInitialized = false;
        this.modules = {};
    }

    async initialize() {
        if (this.isInitialized) {
            console.log('🐻 Orchestrator: Already initialized');
            return;
        }

        try {
            console.log(`🐻 Orchestrator: Initializing for ${this.isScriptable ? 'Scriptable' : 'Web'} environment`);
            
            // Load modules based on environment
            await this.loadModules();
            
            this.isInitialized = true;
            console.log('🐻 Orchestrator: ✓ Initialization complete');
            
        } catch (error) {
            console.error('🐻 Orchestrator: ✗ Initialization failed:', error);
            throw new Error(`Initialization failed: ${error.message}`);
        }
    }

    async loadModules() {
        if (this.isScriptable) {
            await this.loadScriptableModules();
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
            console.error('📱 ✗ Failed to load Scriptable modules:', error);
            throw new Error(`Scriptable module loading failed: ${error.message}`);
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
            console.error('🌐 ✗ Failed to load web modules:', error);
            throw new Error(`Web module loading failed: ${error.message}`);
        }
    }

    async run() {
        try {
            // Initialize if not already done
            if (!this.isInitialized) {
                await this.initialize();
            }

            console.log('🐻 Orchestrator: Starting event scraping process...');

            // Create adapter instance
            const adapter = new this.modules.adapter();
            
            // Load configuration
            const config = await adapter.loadConfiguration();
            console.log(`🐻 Orchestrator: Loaded configuration with ${config.parsers?.length || 0} parsers`);

            // Create shared core instance
            const sharedCore = new this.modules.SharedCore();

            // Create parser instances
            const parsers = {};
            for (const [name, ParserClass] of Object.entries(this.modules.parsers)) {
                parsers[name] = new ParserClass();
            }

            console.log(`🐻 Orchestrator: Created ${Object.keys(parsers).length} parser instances`);

            // Process events using shared core
            const results = await sharedCore.processEvents(config, adapter, adapter, parsers);

            // Display results
            await adapter.displayResults(results);

            console.log('🐻 Orchestrator: ✓ Event scraping completed successfully');
            return results;

        } catch (error) {
            console.error('🐻 Orchestrator: ✗ Event scraping failed:', error);
            
            // Try to show user-friendly error
            if (this.modules.adapter) {
                const adapter = new this.modules.adapter();
                await adapter.showError('Bear Event Scraper Error', error.message);
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
        console.error('🐻 Bear Event Scraper: Execution failed:', error);
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


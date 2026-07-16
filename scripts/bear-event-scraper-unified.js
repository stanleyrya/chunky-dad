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

console.log('🐻 Bear Event Scraper: Starting...');

class BearEventScraperOrchestrator {
    constructor(config = {}) {
        this.isScriptable = typeof importModule !== 'undefined';
        this.isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
        this.isWeb = typeof window !== 'undefined';
        this.isInitialized = false;
        this.modules = {};
        this.config = config;
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
            const eventSchemaModule = importModule('event-schema');
            const normalizersModule = importModule('normalizers');
            const scriptableAdapterModule = importModule('adapters/scriptable-adapter');
            
            // Load parsers
            const bearracudaParserModule = importModule('parsers/bearracuda-parser');
            const chunkParserModule = importModule('parsers/chunk-parser');
            const linktreeParserModule = importModule('parsers/linktree-parser');
            const redeyeticketsParserModule = importModule('parsers/redeyetickets-parser');
            const scriptableUrlParserModule = importModule('parsers/scriptable-url-parser');
            const aiWebParserModule = importModule('parsers/ai-web-parser');
            
            // Store modules
            this.modules = {
                SharedCore: sharedCoreModule.SharedCore,
                EventSchema: eventSchemaModule.EventSchema,
                NormalizerPipeline: normalizersModule.NormalizerPipeline,
                adapter: scriptableAdapterModule.ScriptableAdapter,
                parsers: {
                    bearracuda: bearracudaParserModule.BearraccudaParser,
                    chunk: chunkParserModule.ChunkParser,
                    linktree: linktreeParserModule.LinktreeParser,
                    redeyetickets: redeyeticketsParserModule.RedEyeTicketsParser,
                    'scriptable-input': scriptableUrlParserModule.ScriptableUrlParser,
                    'ai-web': aiWebParserModule.AiWebParser
                }
            };
            this.validateLoadedModules('Scriptable');
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
            const eventSchemaModule = require('./event-schema');
            const normalizersModule = require('./normalizers');
            const webAdapterModule = require('./adapters/web-adapter');
            
            // Load parsers
            const bearracudaParserModule = require('./parsers/bearracuda-parser');
            const chunkParserModule = require('./parsers/chunk-parser');
            const linktreeParserModule = require('./parsers/linktree-parser');
            const redeyeticketsParserModule = require('./parsers/redeyetickets-parser');
            const scriptableUrlParserModule = require('./parsers/scriptable-url-parser');
            const aiWebParserModule = require('./parsers/ai-web-parser');
            
            // Store modules
            this.modules = {
                SharedCore: sharedCoreModule.SharedCore,
                EventSchema: eventSchemaModule.EventSchema,
                NormalizerPipeline: normalizersModule.NormalizerPipeline,
                adapter: webAdapterModule.WebAdapter,
                parsers: {
                    bearracuda: bearracudaParserModule.BearraccudaParser,
                    chunk: chunkParserModule.ChunkParser,
                    linktree: linktreeParserModule.LinktreeParser,
                    redeyetickets: redeyeticketsParserModule.RedEyeTicketsParser,
                    'scriptable-input': scriptableUrlParserModule.ScriptableUrlParser,
                    'ai-web': aiWebParserModule.AiWebParser
                }
            };
            this.validateLoadedModules('Node.js');
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
                'EventSchema', 'SharedCore', 'NormalizerPipeline', 'WebAdapter',
                'BearraccudaParser', 'ChunkParser', 'LinktreeParser', 'RedEyeTicketsParser'
            ];
            
            const missingModules = requiredModules.filter(module => !window[module]);
            
            if (missingModules.length > 0) {
                throw new Error(`Missing web modules: ${missingModules.join(', ')}. Ensure all files are loaded via script tags.`);
            }
            
            // Store modules
            const parsers = {
                bearracuda: window.BearraccudaParser,
                chunk: window.ChunkParser,
                linktree: window.LinktreeParser,
                redeyetickets: window.RedEyeTicketsParser
            };

            if (window.ScriptableUrlParser) {
                parsers['scriptable-input'] = window.ScriptableUrlParser;
            }
            if (window.AiWebParser) {
                parsers['ai-web'] = window.AiWebParser;
            }

            this.modules = {
                EventSchema: window.EventSchema,
                SharedCore: window.SharedCore,
                NormalizerPipeline: window.NormalizerPipeline,
                adapter: window.WebAdapter,
                parsers
            };
            this.validateLoadedModules('Web');
        } catch (error) {
            console.error(`🌐 ✗ Failed to load web modules: ${error}`);
            throw new Error(`Web module loading failed: ${error.message}`);
        }
    }

    validateLoadedModules(environmentName) {
        const schema = this.modules && this.modules.EventSchema;
        if (!schema) {
            throw new Error(`${environmentName} modules missing EventSchema`);
        }
        const requiredSchemaFns = [
            'canonicalizeEventKey',
            'parseNotesIntoFields',
            'formatEventNotes',
            'findUnescaped',
            'unescapeText',
            'isValidMetadataKey'
        ];
        requiredSchemaFns.forEach(fnName => {
            if (typeof schema[fnName] !== 'function') {
                throw new Error(`${environmentName} EventSchema missing required function: ${fnName}`);
            }
        });
        if (!schema.DEFAULT_NOTES_EXCLUDED_FIELDS || typeof schema.DEFAULT_NOTES_EXCLUDED_FIELDS.has !== 'function') {
            throw new Error(`${environmentName} EventSchema missing DEFAULT_NOTES_EXCLUDED_FIELDS Set`);
        }
    }

    async run() {
        try {
            // Initialize if not already done
            if (!this.isInitialized) {
                await this.initialize();
            }

            // Create adapter instance first
            const adapter = new this.modules.adapter();
            
            // Load configuration early so we can pass cities config to SharedCore
            const config = await adapter.loadConfiguration();

            // Curated bar data: the website's merged copy is fresher than any
            // local scraper-bars.js the moment a bar edit lands. Refresh ALL
            // cities up front (null cityKeys — the scraper can't know its
            // cities before normalization assigns them). Fail-soft: any error
            // keeps the local bars, and adapters without the method (web) are
            // tolerated — scraping must never depend on chunky.dad being up.
            let bars = config.bars || {};
            if (typeof adapter.refreshRemoteBars === 'function') {
                try {
                    const refreshed = await adapter.refreshRemoteBars(null, bars);
                    if (refreshed && refreshed.bars && typeof refreshed.bars === 'object') {
                        bars = refreshed.bars;
                    }
                } catch (error) {
                    console.log(`🐻 Orchestrator: Bar data refresh failed (${error.message}) — continuing with local bars`);
                }
            }

            // Create the normalizer pipeline first
            const normalizerPipeline = new this.modules.NormalizerPipeline();

            // Create shared core instance with cities configuration
            const sharedCore = new this.modules.SharedCore(config.cities, {
                eventSchema: this.modules.EventSchema,
                normalizerPipeline: normalizerPipeline,
                additionalExcludedFields: this.modules.adapter.NOTES_EXCLUDED_FIELDS,
                pageClassificationRules: config.config?.pageClassificationRules || [],
                bars
            });
            
            // Wire the core back into the pipeline
            normalizerPipeline.setCore(sharedCore);

            // Create adapter with cities configuration
            let finalAdapter = adapter;
            if (config.cities) {
                finalAdapter = new this.modules.adapter({
                    cities: config.cities,
                    pageCache: config.config?.pageCache || null,
                    // Global OCR block, for the end-of-run cache-retention prune
                    ocr: config.config?.ocr || null,
                    // Carry the resolved run context (automation overrides) into the
                    // instance that saves runs/metrics, not just the config object
                    runtime: config.runtime || null,
                    ...this.config
                });
            }

            // Create parser instances
            const parsers = {};
            for (const [name, ParserClass] of Object.entries(this.modules.parsers)) {
                try {
                    if (name === 'scriptable-input') {
                        parsers[name] = new ParserClass({}, {
                            eventSchema: this.modules.EventSchema
                        });
                    } else if (name === 'ai-web') {
                        const aiParser = new ParserClass({
                            normalizeUrl: sharedCore.normalizeUrl.bind(sharedCore)
                        });
                        aiParser.core = sharedCore;
                        parsers[name] = aiParser;
                    } else {
                        parsers[name] = new ParserClass();
                    }
                } catch (error) {
                    console.error(`🐻 Orchestrator: ✗ Failed to create ${name} parser: ${error}`);
                    throw new Error(`Failed to create ${name} parser: ${error.message}`);
                }
            }

            // Learned dead-end store: adapter owns persistence, shared-core owns
            // the (pure) skip/retry semantics — load before the run, save after.
            try {
                if (typeof finalAdapter.loadDeadEnds === 'function') {
                    config.deadEndStore = await finalAdapter.loadDeadEnds();
                }
            } catch (error) {
                console.log(`🐻 Orchestrator: Dead-end store load failed (${error.message}) — continuing with empty store`);
                config.deadEndStore = {};
            }

            // Process events using shared core
            const results = await sharedCore.processEvents(config, finalAdapter, finalAdapter, parsers);

            try {
                if (results.deadEndStoreChanged && results.deadEndStore && typeof finalAdapter.saveDeadEnds === 'function') {
                    await finalAdapter.saveDeadEnds(results.deadEndStore);
                }
            } catch (error) {
                console.log(`🐻 Orchestrator: Dead-end store save failed: ${error.message}`);
            }

            results.config = config;
            results.calendarEvents = 0;
            if (!Array.isArray(results.analyzedEvents)) {
                results.analyzedEvents = [];
            }

            // Add to calendar if not dry run and we have events
            if (results.allProcessedEvents && results.allProcessedEvents.length > 0) {
                console.log(`🐻 Orchestrator: Preparing ${results.allProcessedEvents.length} events for calendar...`);

                let calendarEvents = 0;

                // Check if we should add to calendar
                const isDryRun = Boolean(config.config?.dryRun);
                
                // Always prepare events for analysis (even in dry run mode) to show action types
                // Perform cross-parser deduplication to merge events from different parsers
                const deduplicatedEvents = await sharedCore.deduplicateEvents(results.allProcessedEvents, finalAdapter, config.config);
                
                const analyzedEvents = await sharedCore.prepareEventsForCalendar(deduplicatedEvents, finalAdapter, config.config);
                console.log(`🐻 Orchestrator: Calendar analysis complete (${deduplicatedEvents.length} unique)`);
                
                // Store analyzed events back into results for display
                results.analyzedEvents = analyzedEvents;
                
                // Update totals to reflect cross-parser deduplication
                results.deduplicatedEvents = deduplicatedEvents.length;

                // Determine execution mode based on environment
                const automationRun = Boolean(config?.runtime?.automationRun);
                const isWidget = this.isScriptable && Boolean(config?.runtime?.runsInWidget);
                const hasDisplay = (this.isScriptable || this.isWeb) && !automationRun;
                if (automationRun) {
                    console.log('🐻 Orchestrator: Automation run detected - executing without UI prompt');
                }

                if (!isDryRun && typeof finalAdapter.executeCalendarActions === 'function' && analyzedEvents) {
                    if (hasDisplay && !isWidget) {
                        // If we have a display (not widget), show results first and let user decide
                        console.log('🐻 Orchestrator: Display mode - review results before execution');
                        // The display will handle the execution decision
                    } else {
                        // No display (automation or widget mode) - execute directly,
                        // excluding events from parsers marked dryRun
                        const executableEvents = this.modules.SharedCore.filterEventsForExecution(analyzedEvents);
                        const dryRunSkipped = analyzedEvents.length - executableEvents.length;
                        if (dryRunSkipped > 0) {
                            console.log(`🐻 Orchestrator: Excluding ${dryRunSkipped} events from dry-run parsers`);
                        }
                        console.log(`🐻 Orchestrator: Executing calendar actions (${executableEvents.length} events)`);
                        try {
                            calendarEvents = await finalAdapter.executeCalendarActions(executableEvents, config);
                            console.log(`🐻 Orchestrator: ✓ Processed ${calendarEvents} events to calendar`);
                        } catch (error) {
                            console.error(`🐻 Orchestrator: ✗ Failed to process events to calendar: ${error.message}`);
                            results.errors.push(`Calendar processing failed: ${error.message}`);
                        }
                    }
                } else {
                    console.log('🐻 Orchestrator: Skipping calendar execution (dry run or unsupported)');
                }

                results.calendarEvents = calendarEvents;
            }

            // Display results
            await finalAdapter.displayResults(results);

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

// Auto-execute when loaded — but never on require(): in Node, only run when
// invoked directly, so tests/tools can import the orchestrator without scraping.
// Scriptable also defines a module global, so check importModule first.
const isScriptableEnvironment = typeof importModule !== 'undefined';
const isNodeEnvironment = !isScriptableEnvironment && typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
const isDirectNodeRun = isNodeEnvironment && typeof require !== 'undefined' && require.main === module;
if (!isNodeEnvironment || isDirectNodeRun) {
    (async () => {
        try {
            const results = await BearEventScraperOrchestrator.execute();
            console.log('🐻 Bear Event Scraper: Execution completed successfully');
        } catch (error) {
            console.error(`🐻 Bear Event Scraper: Execution failed: ${error}`);
            if (typeof process !== 'undefined') {
                process.exitCode = 1;
            }
        } finally {
            if (typeof Script !== 'undefined' && typeof Script.complete === 'function') {
                Script.complete();
            }
        }
    })();
}

// Export for manual execution if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BearEventScraperOrchestrator };
} else if (typeof window !== 'undefined') {
    window.BearEventScraperOrchestrator = BearEventScraperOrchestrator;
} else {
    // Scriptable environment
    this.BearEventScraperOrchestrator = BearEventScraperOrchestrator;
}

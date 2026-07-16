// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: map-marked-alt;
//
// ============================================================================
// CALENDAR REVIEWER - LIGHTWEIGHT ORCHESTRATOR
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file is a LIGHTWEIGHT ORCHESTRATOR only
//
// Reviews EXISTING chunky-dad calendar events against pluggable data-quality
// checks (v1: geocode — see SharedCore.getCalendarReviewChecks) and presents
// the findings in an interactive WebView UI. Nothing is written to a
// calendar except through the UI's Apply buttons.
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Environment detection and module loading
// ✅ Configuration management
// ✅ Error handling and user feedback
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Business logic (that belongs in shared-core.js)
// ❌ Calendar/UI operations (that belongs in adapters/)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

console.log('🔎 Calendar Reviewer: Starting...');

// User-tunable configuration
const REVIEWER_CONFIG = {
    // Explicit calendar titles to review; empty = every writable calendar
    // whose title starts with "chunky-dad"
    calendars: [],
    lookbackDays: 365,
    lookaheadDays: 365,
    // Stored pin vs fresh verified geocode divergence that flags "pin-moved"
    pinMovedThresholdKm: 0.4,
    // Same knob as the scraper (scraper-input.js): report | enforce | off
    geocodeVerification: { mode: 'report' },
    // Same shape as the scraper's pageCache so geocode results share the
    // scraper's persistent cache
    pageCache: { enabled: true, ttlDays: 3 }
};

class CalendarReviewerOrchestrator {
    constructor(config = {}) {
        this.isScriptable = typeof importModule !== 'undefined';
        this.isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
        this.config = { ...REVIEWER_CONFIG, ...config };
        this.modules = {};
    }

    loadModules() {
        if (this.isScriptable) {
            console.log('🔎 Calendar Reviewer: Loading Scriptable modules...');
            const sharedCoreModule = importModule('shared-core');
            const eventSchemaModule = importModule('event-schema');
            const normalizersModule = importModule('normalizers');
            const scriptableAdapterModule = importModule('adapters/scriptable-adapter');
            this.modules = {
                SharedCore: sharedCoreModule.SharedCore,
                EventSchema: eventSchemaModule.EventSchema,
                OpenStreetMapNormalizer: normalizersModule.OpenStreetMapNormalizer,
                Adapter: scriptableAdapterModule.ScriptableAdapter,
                cities: importModule('scraper-cities')
            };
        } else {
            // Node: no Scriptable calendars exist, so a Node run only proves
            // the pure modules load (CI syntax checking). The adapter is NOT
            // required here — it needs Scriptable globals at load time.
            console.log('🔎 Calendar Reviewer: Loading Node.js modules...');
            this.modules = {
                SharedCore: require('./shared-core').SharedCore,
                EventSchema: require('./event-schema').EventSchema,
                OpenStreetMapNormalizer: require('./normalizers').OpenStreetMapNormalizer,
                Adapter: null,
                cities: null
            };
        }
    }

    async run() {
        this.loadModules();

        if (!this.isScriptable) {
            console.log('🔎 Calendar Reviewer: This tool reviews iOS calendars — run it in Scriptable. (Modules loaded OK; exiting.)');
            return null;
        }

        const config = this.config;
        const adapter = new this.modules.Adapter({
            cities: this.modules.cities,
            pageCache: config.pageCache || null
        });
        const core = new this.modules.SharedCore(this.modules.cities, {
            eventSchema: this.modules.EventSchema,
            additionalExcludedFields: this.modules.Adapter.NOTES_EXCLUDED_FIELDS
        });
        // The geocode check reuses the scraper's normalizer (grade gate, retry
        // ladder, verification) rather than reimplementing any of it
        const geocodeNormalizer = new this.modules.OpenStreetMapNormalizer(core);

        try {
            const calendars = await adapter.getReviewCalendars(config.calendars);
            if (calendars.length === 0) {
                await adapter.showError('Calendar Reviewer', 'No matching calendars found. Create chunky-dad-<city> calendars or list titles in REVIEWER_CONFIG.calendars.');
                return null;
            }

            const events = await adapter.getReviewCalendarEvents(calendars, config);
            const findings = await core.reviewCalendarEvents(events, {
                httpAdapter: adapter,
                geocodeNormalizer,
                pinMovedThresholdKm: config.pinMovedThresholdKm,
                geocodeVerification: config.geocodeVerification
            });

            const summary = this.modules.SharedCore.summarizeReviewFindings(findings);
            console.log(`🔎 REVIEW: ${summary.findings} event(s) reviewed — ${summary.ok} ok, ${summary.proposals} with proposed fixes`);

            const appliedCounts = await adapter.presentReviewResults(findings, { config });
            return { findings, summary, appliedCounts };
        } catch (error) {
            console.error(`🔎 Calendar Reviewer: ✗ Review failed: ${error}`);
            if (error.stack && error.stack.trim()) {
                console.error(`🔎 Calendar Reviewer: ✗ Error stack trace: ${error.stack}`);
            }
            try {
                await adapter.showError('Calendar Reviewer Error', `${error.name || 'Error'}: ${error.message || 'An unexpected error occurred'}\n\nCheck console for full details.`);
            } catch (displayError) {
                console.error(`🔎 Calendar Reviewer: ✗ Failed to show error dialog: ${displayError}`);
            }
            throw error;
        }
    }

    // Static method for easy execution
    static async execute() {
        const orchestrator = new CalendarReviewerOrchestrator();
        return await orchestrator.run();
    }
}

// Auto-execute when loaded — but never on require(): in Node, only run when
// invoked directly, so tests/tools can import the orchestrator without
// touching calendars. Scriptable also defines a module global, so check
// importModule first.
const isScriptableEnvironment = typeof importModule !== 'undefined';
const isNodeEnvironment = !isScriptableEnvironment && typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
const isDirectNodeRun = isNodeEnvironment && typeof require !== 'undefined' && require.main === module;
if (!isNodeEnvironment || isDirectNodeRun) {
    (async () => {
        try {
            await CalendarReviewerOrchestrator.execute();
            console.log('🔎 Calendar Reviewer: Execution completed successfully');
        } catch (error) {
            console.error(`🔎 Calendar Reviewer: Execution failed: ${error}`);
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
    module.exports = { CalendarReviewerOrchestrator };
} else {
    // Scriptable environment
    this.CalendarReviewerOrchestrator = CalendarReviewerOrchestrator;
}

// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: book-open;

// Display Saved Bear Event Scraper Run
// Loads previously saved run JSON from iCloud and renders via ScriptableAdapter
// 
// MODES:
// - Widget/Read-Only (readOnly: true): Safe viewing only, forces isDryRun override
// - Manual Run (readOnly: false): Preserves original config, allows calendar updates

// Display-specific functionality
class SavedRunDisplay {
    constructor() {
        this.adapter = null;
    }

    async showError(title, message) {
        const alert = new Alert();
        alert.title = title;
        alert.message = message;
        alert.addAction('OK');
        await alert.present();
    }

    async listSavedRuns() {
        // Read directory contents directly - no index needed
        try {
            const fm = FileManager.iCloud();
            const documentsDir = fm.documentsDirectory();
            const rootDir = fm.joinPath(documentsDir, 'chunky-dad-scraper');
            const runsDir = fm.joinPath(rootDir, 'runs');
            
            console.log(`📱 Display: Checking for saved runs in ${runsDir}`);
            
            // Check if root directory exists first
            if (!fm.fileExists(rootDir)) {
                fm.createDirectory(rootDir, true);
            }
            
            if (!fm.fileExists(runsDir)) {
                fm.createDirectory(runsDir, true);
                console.log(`📱 Display: No saved runs found - created runs directory`);
                return [];
            }
            
            // LIST WITHOUT DOWNLOADING: enumeration is metadata-only
            // (listContents/isDirectory/isFileDownloaded). The old per-file
            // downloadFileFromiCloud here blocked the entire screen on one
            // Mac-written run file still uploading to iCloud (2026-08-15
            // hang). The YYYYMMDD-HHMMSS filename already carries the list
            // label; the actual download happens on OPEN, bounded — see
            // loadSavedRun.
            const { ScriptableAdapter } = importModule('adapters/scriptable-adapter');
            const { entries: jsonFiles, errors: fileErrors } =
                ScriptableAdapter.listSavedRunEntries(fm, runsDir);

            console.log(`📱 Display: Found ${jsonFiles.length} saved runs${fileErrors.length > 0 ? ` (${fileErrors.length} files had errors)` : ''}`);

            if (jsonFiles.length === 0) {
                console.log(`📱 Display: No .json run files found in directory`);
            }

            const syncingCount = jsonFiles.filter(e => e.downloaded === false).length;
            if (syncingCount > 0) {
                console.log(`📱 Display: ${syncingCount} run(s) not yet downloaded from iCloud — listed as syncing, downloaded on open`);
            }

            return jsonFiles;
        } catch (e) {
            console.log(`📱 Display: Failed to read runs directory: ${e.message}`);
            return [];
        }
    }

    async loadSavedRun(runId) {
        try {
            console.log(`📱 Display: loadSavedRun called with runId: ${JSON.stringify(runId)} (type: ${typeof runId})`);
            
            const fm = FileManager.iCloud();
            const documentsDir = fm.documentsDirectory();
            const rootDir = fm.joinPath(documentsDir, 'chunky-dad-scraper');
            const runsDir = fm.joinPath(rootDir, 'runs');
            const fileName = `${runId}.json`;
            const runFilePath = fm.joinPath(runsDir, fileName);
            
            console.log(`📱 Display: Path components - documentsDir: ${documentsDir}`);
            console.log(`📱 Display: Path components - rootDir: ${rootDir}`);
            console.log(`📱 Display: Path components - runsDir: ${runsDir}`);
            console.log(`📱 Display: Path components - fileName: ${fileName}`);
            console.log(`📱 Display: Loading run from: ${runFilePath}`);
            if (!fm.fileExists(runFilePath)) {
                console.log(`📱 Display: Run file does not exist: ${runFilePath}`);
                return null;
            }

            // DOWNLOAD ON OPEN, BOUNDED: fetch just this run's file with a
            // 30s cap so an iCloud sync stall surfaces an alert and returns
            // to the list instead of hanging the screen. On timeout the
            // kicked download keeps running in the background, so trying
            // again shortly usually finds the file already local.
            const { ScriptableAdapter } = importModule('adapters/scriptable-adapter');
            const syncTimeoutMs = 30000;
            console.log(`📱 Display: Ensuring run file is local (bounded ${syncTimeoutMs / 1000}s iCloud download): ${fileName}`);
            const download = await ScriptableAdapter.downloadFileBounded(fm, runFilePath, syncTimeoutMs);
            if (!download.ok && download.timedOut) {
                console.log(`📱 Display: Run ${runId} is still syncing from iCloud after ${syncTimeoutMs / 1000}s — not blocking the list`);
                return { __icloudSyncPending: true, runId };
            }
            if (!download.ok && download.error) {
                console.log(`📱 Display: Bounded iCloud download reported: ${download.error} — falling through to read retries`);
            }

            // Robust iCloud download with multiple retries
            let content = null;
            const maxRetries = 3;
            
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                console.log(`📱 Display: Download attempt ${attempt}/${maxRetries}`);
                
                try {
                    // Force download from iCloud
                    await fm.downloadFileFromiCloud(runFilePath);
                    console.log(`📱 Display: Download completed for attempt ${attempt}`);
                } catch (downloadError) {
                    console.log(`📱 Display: Download attempt ${attempt} failed: ${downloadError.message}`);
                }
                
                // Try to read the file
                content = fm.readString(runFilePath);
                console.log(`📱 Display: Read attempt ${attempt} result: ${content === null ? 'null' : content === undefined ? 'undefined' : `${content.length} characters`}`);
                
                if (content !== null && content !== undefined && content.trim().length > 0) {
                    console.log(`📱 Display: Successfully got content on attempt ${attempt}`);
                    break;
                }
                
                if (attempt < maxRetries) {
                    console.log(`📱 Display: Waiting 2 seconds before retry...`);
                    await new Promise(resolve => Timer.schedule(2000, false, resolve));
                }
            }
            
            if (content === null || content === undefined) {
                console.log(`📱 Display: File content is null or undefined after retry`);
                return null;
            }
            
            if (content.trim().length === 0) {
                console.log(`📱 Display: File content is empty`);
                return null;
            }
            
            console.log(`📱 Display: Successfully read file, content length: ${content.length}`);
            const parsed = JSON.parse(content);
            console.log(`📱 Display: Successfully parsed JSON, keys: ${Object.keys(parsed)}`);
            return parsed;
        } catch (e) {
            console.log(`📱 Display: Failed to load run ${runId}: ${e.message}`);
            return null;
        }
    }

    async displaySavedRun(options = {}) {
        try {
            const runs = await this.listSavedRuns();
            if (!runs || runs.length === 0) {
                await this.showError('No saved runs', 'No saved runs were found to display.\n\nTo create runs, first run the bear-event-scraper-unified.js script.\n\nRuns are saved in the chunky-dad-scraper/runs/ directory relative to where this script is located.');
                return;
            }

            // Interactive mode loops back to the picker when a run's iCloud
            // download times out, instead of hanging or dead-ending.
            const interactive = !options.runId && !options.last && options.presentHistory;
            let saved = null;
            let runIdString = null;
            for (;;) {
                let runToShow = null;
                if (options.runId) {
                    runToShow = options.runId;
                } else if (options.last) {
                    runToShow = runs[0].runId || runs[0];
                } else if (options.presentHistory) {
                    // Simple selection UI using Alert
                    const alert = new Alert();
                    alert.title = 'Select Saved Run';
                    alert.message = 'Choose a run to display';
                    runs.slice(0, 25).forEach((r, idx) => {
                        const syncMark = r.downloaded === false ? ' ☁️ syncing…' : '';
                        const label = (r.timestamp ? `${idx + 1}. ${r.timestamp}` : `${idx + 1}. ${r.runId}`) + syncMark;
                        alert.addAction(label);
                    });
                    alert.addCancelAction('Cancel');
                    const idx = await alert.present();
                    if (idx < 0 || idx >= runs.length) return;
                    runToShow = runs[idx].runId || runs[idx];
                }

                if (!runToShow) {
                    runToShow = runs[0].runId || runs[0];
                }

                console.log(`📱 Display: About to load runToShow: ${JSON.stringify(runToShow)} (type: ${typeof runToShow})`);

                // Ensure runToShow is a string, not an object
                runIdString = typeof runToShow === 'string' ? runToShow : runToShow.runId || runToShow.toString();
                console.log(`📱 Display: Final runId to load: ${runIdString}`);

                saved = await this.loadSavedRun(runIdString);
                if (saved && saved.__icloudSyncPending === true) {
                    await this.showError('Still syncing from iCloud', `Run ${runIdString} is still syncing from iCloud — try again shortly.`);
                    if (interactive) {
                        saved = null;
                        continue; // back to the run list
                    }
                    return;
                }
                break;
            }

            if (!saved) {
                await this.showError('Load failed', `Could not load saved run: ${runIdString}`);
                return;
            }

            // Normalize to the same shape expected by display/present methods
            // (re-saving is prevented by the _isDisplayingSavedRun flag the adapter checks)
            let config = saved?.config;
            
            // If readOnly mode (default), force isDryRun override for all parsers
            if (options.readOnly !== false && config && config.parsers) {
                config = JSON.parse(JSON.stringify(config)); // Clone
                config.parsers = config.parsers.map(parser => ({
                    ...parser,
                    dryRun: true  // Total override - force dry run mode
                }));
            }
            
            const savedRunContext = saved?.runContext || saved?.summary?.runContext || null;
            const resultsLike = {
                totalEvents: saved?.summary?.totals?.totalEvents || 0,
                bearEvents: saved?.summary?.totals?.bearEvents || 0,
                calendarEvents: 0, // Display-only value; the adapter's _isDisplayingSavedRun guard is what prevents re-saving
                errors: saved?.errors || [],
                parserResults: saved?.parserResults || [],
                analyzedEvents: Array.isArray(saved?.analyzedEvents) ? saved.analyzedEvents : [],
                // Dropped non-bear events are part of the run's result and the
                // results UI renders them as real event cards. Omitting them
                // here made that whole section invisible for saved runs — the
                // one place you actually review a past run's bear calls.
                // (Overrides stay inert: _isDisplayingSavedRun renders the
                // section read-only.)
                bearDroppedEvents: Array.isArray(saved?.bearDroppedEvents) ? saved.bearDroppedEvents : [],
                // Report-only calendar hygiene checklist — render it for
                // saved runs too (older runs simply have none).
                calendarHygiene: Array.isArray(saved?.calendarHygiene) ? saved.calendarHygiene : [],
                config: config,
                sourceRunId: saved?.summary?.runId || null,
                // Execute-from-saved-run support (adapter feature-detects all
                // of these; older adapters simply ignore them):
                // — the run's saved timestamp drives the staleness guard and
                //   keeps a post-execution rewrite on the SAME file/timestamp
                _savedRunTimestamp: saved?.summary?.timestamp || null,
                // — prior executions are threaded back so a re-execution
                //   APPENDS to the audit trail instead of overwriting it
                savedRunExecutions: Array.isArray(saved?.executions) ? saved.executions : [],
                // — prior ICS-export UID ledger entries thread back the same
                //   way, so a post-execution rewrite appends instead of
                //   erasing the uids earlier exports minted
                icsExports: Array.isArray(saved?.icsExports) ? saved.icsExports : [],
                // — the ORIGINAL config (pre readOnly dryRun-forcing clone),
                //   so a post-execution rewrite records what the run really ran with
                _savedRunOriginalConfig: saved?.config || null,
                runContext: {
                    type: 'display',
                    environment: 'scriptable',
                    trigger: 'saved-run',
                    original: savedRunContext
                },
                _savedRunContext: savedRunContext,
                _isDisplayingSavedRun: true // Flag to indicate this is a saved run display
            };

            // Initialize adapter and display results
            // Load configuration to get cities data for timezone lookup
            const scraperConfig = importModule('scraper-input');
            const scraperCities = importModule('scraper-cities');
            const { ScriptableAdapter } = importModule('adapters/scriptable-adapter');
            const adapterConfig = {
                ...scraperConfig,
                cities: scraperCities
            };
            this.adapter = new ScriptableAdapter(adapterConfig);
            await this.adapter.displayResults(resultsLike);
        } catch (e) {
            console.log(`📱 Display: Failed to display saved run: ${e.message}`);
        }
    }
}

try {
    const display = new SavedRunDisplay();

    const toBool = (value, fallback) => {
        if (value === undefined || value === null) return fallback;
        if (typeof value === 'boolean') return value;
        const normalized = String(value).toLowerCase();
        if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
        return fallback;
    };

    const query = (typeof args !== 'undefined' && args.queryParameters) ? args.queryParameters : {};
    const widgetParam = (typeof args !== 'undefined' && args.widgetParameter) ? args.widgetParameter : null;
    const runIdFromQuery = query.runId || query.runid || null;
    let runIdFromParam = null;
    let lastFromParam = false;
    if (widgetParam) {
        const trimmed = String(widgetParam).trim();
        if (trimmed.toLowerCase() === 'last') {
            lastFromParam = true;
        } else if (trimmed.toLowerCase().startsWith('runid:')) {
            runIdFromParam = trimmed.slice('runid:'.length).trim();
        }
    }

    const runId = runIdFromQuery || runIdFromParam || null;
    const last = runId ? false : (toBool(query.last, false) || lastFromParam);
    const presentHistoryDefault = !runId && !last;

    // Options: change these to control behavior
    const OPTIONS = {
        last: last,                           // set true to auto-load most recent
        runId: runId,                         // or set to a specific runId like "20250101-120000"
        presentHistory: toBool(query.presentHistory, presentHistoryDefault),
        readOnly: toBool(query.readOnly, true) // TOTAL OVERRIDE: forces isDryRun=true, set false for calendar updates
    };

    await display.displaySavedRun(OPTIONS);
} catch (e) {
    console.error(`Display Saved Run failed: ${e.message}`);
    const alert = new Alert();
    alert.title = 'Display Saved Run Error';
    alert.message = `${e.message}`;
    alert.addAction('OK');
    await alert.present();
}

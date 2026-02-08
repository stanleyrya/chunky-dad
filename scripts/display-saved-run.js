// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: book-open;

// Display Saved Bear Event Scraper Run
// Loads previously saved run JSON from iCloud and renders via ScriptableAdapter
// 
// MODES:
// - Widget/Read-Only (readOnly: true): Safe viewing only, forces isDryRun override
// - Manual Run (readOnly: false): Preserves original config, allows calendar updates

/**
 * Author: Ryan Stanley (stanleyrya@gmail.com)
 * Tips: https://www.paypal.me/stanleyrya
 *
 * Class that can read and write JSON objects using the file system.
 *
 * This is a minified version but it can be replaced with the full version here!
 * https://github.com/stanleyrya/scriptable-playground/tree/main/json-file-manager
 *
 * Usage:
 *  * write(relativePath, jsonObject): Writes JSON object to a relative path.
 *  * read(relativePath): Reads JSON object from a relative path.
 */
class JSONFileManager {
    write(relativePath, jsonObject) {
        const fm = this.getFileManager();
        const fullPath = this.getCurrentDir() + relativePath;
        const pathParts = relativePath.split("/");
        
        // Create directory if needed
        if (pathParts.length > 1) {
            const fileName = pathParts[pathParts.length - 1];
            const dirPath = fullPath.replace("/" + fileName, "");
            fm.createDirectory(dirPath, true);
        }
        
        // Check if path is a directory
        if (fm.fileExists(fullPath) && fm.isDirectory(fullPath)) {
            throw new Error("JSON file is a directory, please delete!");
        }
        
        fm.writeString(fullPath, JSON.stringify(jsonObject));
    }
    
    read(relativePath) {
        const fm = this.getFileManager();
        const fullPath = this.getCurrentDir() + relativePath;
        
        if (!fm.fileExists(fullPath)) {
            throw new Error("JSON file does not exist! Could not load: " + fullPath);
        }
        
        if (fm.isDirectory(fullPath)) {
            throw new Error("JSON file is a directory! Could not load: " + fullPath);
        }
        
        fm.downloadFileFromiCloud(fullPath);
        const content = fm.readString(fullPath);
        const parsed = JSON.parse(content);
        
        if (parsed !== null) {
            return parsed;
        }
        
        throw new Error("Could not read file as JSON! Could not load: " + fullPath);
    }
    
    getFileManager() {
        try {
            return FileManager.iCloud();
        } catch (e) {
            return FileManager.local();
        }
    }
    
    getCurrentDir() {
        const fm = this.getFileManager();
        const filename = module.filename;
        return filename.replace(fm.fileName(filename, true), "");
    }
}
const jsonFileManager = new JSONFileManager();

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
            
            // Ensure iCloud files are downloaded before listing
            try {
                await fm.downloadFileFromiCloud(runsDir);
            } catch (downloadError) {
                console.log(`📱 Display: iCloud sync failed: ${downloadError.message}`);
            }
            
            const files = fm.listContents(runsDir) || [];
            
            // Filter out directories and only keep JSON files
            const jsonFiles = [];
            const fileErrors = [];
            for (const name of files) {
                if (!name.endsWith('.json')) continue;
                const filePath = fm.joinPath(runsDir, name);
                try {
                    await fm.downloadFileFromiCloud(filePath);
                } catch (error) {
                    fileErrors.push({ file: name, error: error.message });
                }
                let isDir = false;
                try {
                    isDir = fm.isDirectory(filePath);
                } catch (dirError) {
                    fileErrors.push({ file: name, error: dirError.message });
                }
                if (!isDir) {
                    jsonFiles.push(name);
                }
            }
            
            console.log(`📱 Display: Found ${jsonFiles.length} saved runs${fileErrors.length > 0 ? ` (${fileErrors.length} files had errors)` : ''}`);
            
            if (jsonFiles.length === 0) {
                console.log(`📱 Display: No .json run files found in directory`);
            }
            
            return jsonFiles
                .map(name => ({ runId: name.replace('.json',''), timestamp: null }))
                .sort((a, b) => (b.runId || '').localeCompare(a.runId || ''));
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
            let runToShow = null;
            const runs = await this.listSavedRuns();
            if (!runs || runs.length === 0) {
                await this.showError('No saved runs', 'No saved runs were found to display.\n\nTo create runs, first run the bear-event-scraper-unified.js script.\n\nRuns are saved in the chunky-dad-scraper/runs/ directory relative to where this script is located.');
                return;
            }

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
                    const label = r.timestamp ? `${idx + 1}. ${r.timestamp}` : `${idx + 1}. ${r.runId}`;
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
            const runIdString = typeof runToShow === 'string' ? runToShow : runToShow.runId || runToShow.toString();
            console.log(`📱 Display: Final runId to load: ${runIdString}`);

            const saved = await this.loadSavedRun(runIdString);
            if (!saved) {
                await this.showError('Load failed', `Could not load saved run: ${runToShow}`);
                return;
            }

            // Normalize to the same shape expected by display/present methods
            // Set calendarEvents to 0 to prevent saving a new run when viewing saved runs
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
                calendarEvents: 0, // Always 0 for saved runs to prevent re-saving
                errors: saved?.errors || [],
                parserResults: saved?.parserResults || [],
                analyzedEvents: Array.isArray(saved?.analyzedEvents) ? saved.analyzedEvents : [],
                config: config,
                sourceRunId: saved?.summary?.runId || null,
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

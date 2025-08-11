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
class JSONFileManager{write(e,r){const t=this.getFileManager(),i=this.getCurrentDir()+e,l=e.split("/");if(l>1){const e=l[l.length-1],r=i.replace("/"+e,"");t.createDirectory(r,!0)}if(t.fileExists(i)&&t.isDirectory(i))throw"JSON file is a directory, please delete!";t.writeString(i,JSON.stringify(r))}read(e){const r=this.getFileManager(),t=this.getCurrentDir()+e;if(!r.fileExists(t))throw"JSON file does not exist! Could not load: "+t;if(r.isDirectory(t))throw"JSON file is a directory! Could not load: "+t;r.downloadFileFromiCloud(t);const i=JSON.parse(r.readString(t));if(null!==i)return i;throw"Could not read file as JSON! Could not load: "+t}getFileManager(){try{return FileManager.iCloud()}catch(e){return FileManager.local()}}getCurrentDir(){const e=this.getFileManager(),r=module.filename;return r.replace(e.fileName(r,!0),"")}}
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

    listSavedRuns() {
        // Read directory contents directly - no index needed
        try {
            const fm = FileManager.iCloud();
            const documentsDir = fm.documentsDirectory();
            const rootDir = fm.joinPath(documentsDir, 'chunky-dad-scraper');
            const runsDir = fm.joinPath(rootDir, 'runs');
            
            console.log(`📱 Display: Documents directory: ${documentsDir}`);
            console.log(`📱 Display: Root directory: ${rootDir}`);
            console.log(`📱 Display: Runs directory path: ${runsDir}`);
            console.log(`📱 Display: About to list contents of: ${runsDir}`);
            
            // Debug: Check what's in the root directory
            if (fm.fileExists(rootDir)) {
                const rootFiles = fm.listContents(rootDir) || [];
                console.log(`📱 Display: Root directory contents: ${JSON.stringify(rootFiles)}`);
            }
            
            // Check if root directory exists first
            if (!fm.fileExists(rootDir)) {
                console.log(`📱 Display: Root directory does not exist: ${rootDir}`);
                fm.createDirectory(rootDir, true);
            }
            
            if (!fm.fileExists(runsDir)) {
                console.log(`📱 Display: Runs directory does not exist: ${runsDir}`);
                fm.createDirectory(runsDir, true);
                console.log(`📱 Display: Created runs directory - no saved runs found yet`);
                return [];
            }
            
            // Ensure iCloud files are downloaded before listing
            try {
                fm.downloadFileFromiCloud(runsDir);
            } catch (downloadError) {
                console.log(`📱 Display: Note - iCloud download attempt: ${downloadError.message}`);
            }
            
            // Double-check the directory we're about to list
            console.log(`📱 Display: VERIFICATION - About to call fm.listContents(${runsDir})`);
            const files = fm.listContents(runsDir) || [];
            console.log(`📱 Display: Found ${files.length} files in runs directory: ${JSON.stringify(files)}`);
            
            // Filter out directories and only keep JSON files
            const jsonFiles = files.filter(name => {
                const filePath = fm.joinPath(runsDir, name);
                try {
                    // Ensure each file is downloaded from iCloud
                    fm.downloadFileFromiCloud(filePath);
                    return name.endsWith('.json') && !fm.isDirectory(filePath);
                } catch (error) {
                    console.log(`📱 Display: Error checking file ${name}: ${error.message}`);
                    return false;
                }
            });
            
            console.log(`📱 Display: Filtered to ${jsonFiles.length} JSON files: ${JSON.stringify(jsonFiles)}`);
            
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

    loadSavedRun(runId) {
        try {
            const fm = FileManager.iCloud();
            const documentsDir = fm.documentsDirectory();
            const runFilePath = fm.joinPath(documentsDir, 'chunky-dad-scraper', 'runs', `${runId}.json`);
            
            console.log(`📱 Display: Loading run from: ${runFilePath}`);
            if (!fm.fileExists(runFilePath)) {
                console.log(`📱 Display: Run file does not exist: ${runFilePath}`);
                return null;
            }
            
            // Ensure file is downloaded from iCloud before reading
            try {
                fm.downloadFileFromiCloud(runFilePath);
            } catch (downloadError) {
                console.log(`📱 Display: Note - iCloud download attempt: ${downloadError.message}`);
            }
            
            const content = fm.readString(runFilePath);
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
            const runs = this.listSavedRuns();
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

            const saved = this.loadSavedRun(runToShow);
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
            
            const resultsLike = {
                totalEvents: saved?.summary?.totals?.totalEvents || 0,
                bearEvents: saved?.summary?.totals?.bearEvents || 0,
                calendarEvents: 0, // Always 0 for saved runs to prevent re-saving
                errors: saved?.errors || [],
                parserResults: saved?.parserResults || [],
                analyzedEvents: saved?.analyzedEvents || null,
                config: config,
                _isDisplayingSavedRun: true // Flag to indicate this is a saved run display
            };

            // Initialize adapter and display results
            const { ScriptableAdapter } = importModule('adapters/scriptable-adapter');
            this.adapter = new ScriptableAdapter();
            await this.adapter.displayResults(resultsLike);
        } catch (e) {
            console.log(`📱 Display: Failed to display saved run: ${e.message}`);
        }
    }
}

try {
    const display = new SavedRunDisplay();

    // Options: change these to control behavior
    const OPTIONS = {
        last: false,           // set true to auto-load most recent
        runId: null,           // or set to a specific runId like "20250101-120000"
        presentHistory: true,  // default: present a picker
        readOnly: true         // TOTAL OVERRIDE: forces isDryRun=true, set false for calendar updates
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
// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: book-open;

// Display Saved Bear Event Scraper Run
// Loads previously saved run JSON from iCloud and renders via ScriptableAdapter
// 
// MODES:
// - Widget/Read-Only (readOnly: true): Safe viewing only, forces isDryRun override
// - Manual Run (readOnly: false): Preserves original config, allows calendar updates

// Embedded JSONFileManager for file operations
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
        const indexRelPath = `chunky-dad-scraper/runs/index.json`;
        try {
            const index = jsonFileManager.read(indexRelPath) || [];
            return Array.isArray(index) ? index.filter(item => item && item.runId).sort((a, b) => (b.runId || '').localeCompare(a.runId || '')) : [];
        } catch (e) {
            console.log(`📱 Display: Failed to read run index: ${e.message}`);
        }
        // Fallback: read directory contents
        try {
            const fm = FileManager.iCloud();
            const base = jsonFileManager.getCurrentDir();
            const runsDir = `${base}chunky-dad-scraper/runs`;
            if (!fm.fileExists(runsDir)) return [];
            return fm.listContents(runsDir)
                .filter(name => name.endsWith('.json') && name !== 'index.json')
                .map(name => ({ runId: name.replace('.json',''), timestamp: null }))
                .sort((a, b) => (b.runId || '').localeCompare(a.runId || ''));
        } catch (_) { return []; }
    }

    loadSavedRun(runId) {
        try {
            const relPath = `chunky-dad-scraper/runs/${runId}.json`;
            return jsonFileManager.read(relPath);
        } catch (e) {
            console.log(`📱 Display: Failed to load run ${runId}: ${e.message}`);
            return null;
        }
    }

    makeConfigReadOnlyIfNeeded(config, options) {
        if (!config) return null;
        
        // If readOnly is true (default), force all parsers to dry run mode
        if (options.readOnly !== false && config.parsers) {
            // Clone config and override ALL parsers to dry run mode
            const readOnlyConfig = JSON.parse(JSON.stringify(config));
            readOnlyConfig.parsers = readOnlyConfig.parsers.map(parser => ({
                ...parser,
                dryRun: true  // Total override - always dry run in read-only mode
            }));
            return readOnlyConfig;
        }
        
        return config;
    }

    async displaySavedRun(options = {}) {
        try {
            let runToShow = null;
            const runs = this.listSavedRuns();
            if (!runs || runs.length === 0) {
                await this.showError('No saved runs', 'No saved runs were found to display.');
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
            const resultsLike = {
                totalEvents: saved?.summary?.totals?.totalEvents || 0,
                bearEvents: saved?.summary?.totals?.bearEvents || 0,
                calendarEvents: 0, // Always 0 for saved runs to prevent re-saving
                errors: saved?.errors || [],
                parserResults: saved?.parserResults || [],
                analyzedEvents: saved?.analyzedEvents || null,
                config: this.makeConfigReadOnlyIfNeeded(saved?.config, options),
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
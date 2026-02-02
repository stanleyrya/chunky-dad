// ============================================================================
// SCRIPTABLE ADAPTER - iOS ENVIRONMENT SPECIFIC CODE
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains iOS/Scriptable ONLY code
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Scriptable APIs (Request, Calendar, FileManager, Alert, Notification)
// ✅ iOS-specific HTTP requests and calendar operations
// ✅ Scriptable-specific file operations and UI
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Web APIs (fetch, DOMParser, localStorage, document, window)
// ❌ Business logic (that belongs in shared-core.js)
// ❌ Parsing logic (that belongs in parsers/)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

/**
 * Author: Ryan Stanley (stanleyrya@gmail.com)
 * Tips: https://www.paypal.me/stanleyrya
 *
 * Class that can capture the time functions take in milliseconds then export them to a CSV.
 *
 * This is a minified version but it can be replaced with the full version here!
 * https://github.com/stanleyrya/scriptable-playground/tree/main/json-file-manager
 *
 * Usage:
 *  * wrap(fn, args): Wrap the function calls you want to monitor with this wrapper.
 *  * appendPerformanceDataToFile(relativePath): Use at the end of your script to write the metrics to the CSV file at the relative file path.
 */
class PerformanceDebugger{constructor(){this.performanceResultsInMillis={}}async wrap(e,t,i){const r=Date.now(),s=await e.apply(null,t),n=Date.now(),a=i||e.name;return this.performanceResultsInMillis[a]=n-r,s}async appendPerformanceDataToFile(e){const t=this.getFileManager(),i=this.getCurrentDir()+e,r=e.split("/");if(r>1){const e=r[r.length-1],s=i.replace("/"+e,"");t.createDirectory(s,!0)}if(t.fileExists(i)&&t.isDirectory(i))throw"Performance file is a directory, please delete!";let s,n,a=Object.getOwnPropertyNames(this.performanceResultsInMillis);if(t.fileExists(i)){console.log("File exists, reading headers. To keep things easy we're only going to write to these headers."),await t.downloadFileFromiCloud(i),n=t.readString(i),s=this.getFirstLine(n).split(",")}else console.log("File doesn't exist, using available headers."),n=(s=a).toString();n=n.concat("\n");for(const e of s)this.performanceResultsInMillis[e]&&(n=n.concat(this.performanceResultsInMillis[e])),n=n.concat(",");n=n.slice(0,-1),t.writeString(i,n)}getFirstLine(e){var t=e.indexOf("\n");return-1===t&&(t=void 0),e.substring(0,t)}getFileManager(){try{return FileManager.iCloud()}catch(e){return FileManager.local()}}getCurrentDir(){const e=this.getFileManager(),t=module.filename;return t.replace(e.fileName(t,!0),"")}}
const performanceDebugger = new PerformanceDebugger()

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

/**
 * Author: Ryan Stanley (stanleyrya@gmail.com)
 * Tips: https://www.paypal.me/stanleyrya
 *
 * Class that can write logs to the file system.
 *
 * This is a minified version but it can be replaced with the full version here!
 * https://github.com/stanleyrya/scriptable-playground/tree/main/file-logger
 *
 * Usage:
 *  * log(line): Adds the log line to the class' internal log buffer.
 *  * writeLogs(relativePath): Writes the stored logs to the relative file path.
 */
class FileLogger {
    constructor(options = {}) {
        this.entries = [];
        this.totalBytes = 0;
        this.maxLines = Number.isFinite(options.maxLines) ? options.maxLines : 2000;
        this.maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 250000;
        this.captureMode = options.captureMode || 'all';
        this.consoleWrapped = false;
        this.originalConsole = null;
    }
    
    configure(options = {}) {
        if (Number.isFinite(options.maxLines)) {
            this.maxLines = options.maxLines;
        }
        if (Number.isFinite(options.maxBytes)) {
            this.maxBytes = options.maxBytes;
        }
        if (typeof options.captureMode === 'string') {
            this.captureMode = options.captureMode;
        }
    }
    
    get logs() {
        return this.getLogText({ mode: 'full' });
    }
    
    log(line) {
        this.append('info', line);
    }
    
    warn(line) {
        this.append('warn', line);
    }
    
    error(line) {
        this.append('error', line);
    }
    
    captureConsole() {
        if (this.consoleWrapped) {
            return;
        }
        this.consoleWrapped = true;
        this.originalConsole = {
            log: typeof console.log === 'function' ? console.log : null,
            warn: typeof console.warn === 'function' ? console.warn : null,
            error: typeof console.error === 'function' ? console.error : null
        };
        
        const callOriginal = (method, message) => {
            const original = this.originalConsole?.[method] || this.originalConsole?.log;
            if (typeof original === 'function') {
                original.call(console, message);
            }
        };
        
        console.log = (...args) => {
            const message = this.formatArgs(args);
            this.append('info', message);
            callOriginal('log', message);
        };
        
        if (typeof console.warn === 'function') {
            console.warn = (...args) => {
                const message = this.formatArgs(args);
                this.append('warn', message);
                callOriginal('warn', message);
            };
        }
        
        if (typeof console.error === 'function') {
            console.error = (...args) => {
                const message = this.formatArgs(args);
                this.append('error', message);
                callOriginal('error', message);
            };
        }
    }
    
    append(level, message) {
        const normalized = this.normalizeLevel(level);
        if (this.captureMode === 'none') {
            return;
        }
        if (this.captureMode === 'errors' && normalized === 'info') {
            return;
        }
        const line = this.formatEntry(normalized, message);
        const byteSize = line.length + 1;
        this.entries.push({ level: normalized, line, byteSize });
        this.totalBytes += byteSize;
        this.trimEntries();
    }
    
    formatEntry(level, message) {
        const safeMessage = typeof message === 'string' ? message : this.formatArgs([message]);
        return `${new Date().toISOString()} [${level.toUpperCase()}] ${safeMessage}`;
    }
    
    formatArgs(args) {
        if (!Array.isArray(args) || args.length === 0) {
            return '';
        }
        return args.map(arg => this.formatArg(arg)).join(' ');
    }
    
    formatArg(arg) {
        if (arg instanceof Error) {
            return arg.stack || arg.message || String(arg);
        }
        if (arg === null) return 'null';
        if (arg === undefined) return 'undefined';
        const argType = typeof arg;
        if (argType === 'string') return arg;
        if (argType === 'number' || argType === 'boolean' || argType === 'bigint') {
            return String(arg);
        }
        if (argType === 'function') {
            return `[Function ${arg.name || 'anonymous'}]`;
        }
        if (argType === 'object') {
            try {
                return JSON.stringify(arg);
            } catch (e) {
                return String(arg);
            }
        }
        return String(arg);
    }
    
    normalizeLevel(level) {
        const normalized = String(level || 'info').toLowerCase();
        if (normalized === 'warn' || normalized === 'warning') return 'warn';
        if (normalized === 'error') return 'error';
        return 'info';
    }
    
    trimEntries() {
        const hasMaxLines = Number.isFinite(this.maxLines) && this.maxLines > 0;
        const hasMaxBytes = Number.isFinite(this.maxBytes) && this.maxBytes > 0;
        
        while (hasMaxLines && this.entries.length > this.maxLines) {
            const removed = this.entries.shift();
            this.totalBytes -= removed ? removed.byteSize : 0;
        }
        
        while (hasMaxBytes && this.totalBytes > this.maxBytes && this.entries.length > 0) {
            const removed = this.entries.shift();
            this.totalBytes -= removed ? removed.byteSize : 0;
        }
    }
    
    getLogText(options = {}) {
        const mode = String(options.mode || 'full').toLowerCase();
        if (mode === 'summary' || mode === 'none' || mode === 'off') {
            return '';
        }
        
        let entries = this.entries;
        if (mode === 'errors' || mode === 'error') {
            entries = entries.filter(entry => entry.level === 'error' || entry.level === 'warn');
        }
        
        if (Number.isFinite(options.maxLines) && options.maxLines > 0 && entries.length > options.maxLines) {
            entries = entries.slice(-options.maxLines);
        }
        
        if (Number.isFinite(options.maxBytes) && options.maxBytes > 0) {
            let totalBytes = 0;
            const trimmed = [];
            for (let i = entries.length - 1; i >= 0; i -= 1) {
                const entry = entries[i];
                totalBytes += entry.byteSize;
                if (totalBytes > options.maxBytes) {
                    break;
                }
                trimmed.push(entry);
            }
            entries = trimmed.reverse();
        }
        
        if (!entries.length) {
            return '';
        }
        
        return `${entries.map(entry => entry.line).join('\n')}\n`;
    }
    
    writeLogs(relativePath, options = {}) {
        const fm = this.getFileManager();
        const fullPath = this.getCurrentDir() + relativePath;
        const pathParts = relativePath.split("/");
        
        if (pathParts.length > 1) {
            const fileName = pathParts[pathParts.length - 1];
            const dirPath = fullPath.replace("/" + fileName, "");
            try {
                fm.createDirectory(dirPath, true);
            } catch (dirErr) {
                console.log(`📱 FileLogger: Directory creation failed: ${dirErr.message}`);
            }
        }
        
        if (fm.fileExists(fullPath) && fm.isDirectory(fullPath)) {
            throw new Error("Log file is a directory, please delete!");
        }
        
        const content = this.getLogText(options);
        try {
            fm.writeString(fullPath, content);
            console.log(`📱 Scriptable: Successfully wrote logs to ${fullPath}`);
        } catch (writeErr) {
            console.log(`📱 Scriptable: Failed to write logs: ${writeErr.message}`);
            throw writeErr;
        }
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
const logger = new FileLogger();
logger.captureConsole();

class ScriptableAdapter {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 30000,
            userAgent: config.userAgent || 'chunky-dad-scraper/1.0',
            ...config
        };
        
        // Store cities configuration for calendar mapping
        this.cities = config.cities || {};
        this.lastResults = null; // Store last results for calendar display

        // FileManager available for fallbacks
        this.fm = FileManager.iCloud();
        
        // Initialize directory paths
        const documentsDir = this.fm.documentsDirectory();
        this.baseDir = this.fm.joinPath(documentsDir, 'chunky-dad-scraper');
        this.runsDir = this.fm.joinPath(this.baseDir, 'runs');
        this.logsDir = this.fm.joinPath(this.baseDir, 'logs');
        this.metricsDir = this.fm.joinPath(this.baseDir, 'metrics');
        
        this.runtimeContext = this.getScriptableRuntimeContext();
        this.runStartedAt = new Date();
        this.warnCount = 0;
    }

    getScriptableRuntimeContext() {
        const runtime = {
            environment: 'scriptable',
            type: 'manual',
            trigger: 'app',
            runsInWidget: false,
            runsInApp: false,
            runsInActionExtension: false,
            runsWithSiri: false,
            widgetFamily: null,
            widgetParameter: null
        };
        
        try {
            if (typeof config !== 'undefined') {
                runtime.runsInWidget = !!config.runsInWidget;
                runtime.runsInApp = !!config.runsInApp;
                runtime.runsInActionExtension = !!config.runsInActionExtension;
                runtime.runsWithSiri = !!config.runsWithSiri;
                runtime.widgetFamily = config.widgetFamily || null;
            }
            if (typeof args !== 'undefined') {
                runtime.widgetParameter = args.widgetParameter || null;
            }
        } catch (error) {
            console.log(`📱 Scriptable: Run context detection failed: ${error.message}`);
        }
        
        if (runtime.runsInWidget) {
            runtime.trigger = 'widget';
        } else if (runtime.runsInActionExtension) {
            runtime.trigger = 'action-extension';
        } else if (runtime.runsWithSiri) {
            runtime.trigger = 'siri';
        } else {
            runtime.trigger = runtime.runsInApp ? 'app' : 'unknown';
        }
        
        runtime.type = (runtime.runsInWidget || runtime.runsInActionExtension || runtime.runsWithSiri)
            ? 'automated'
            : 'manual';
        
        return runtime;
    }

    resolveRunContext(results) {
        const runtimeContext = this.runtimeContext || this.getScriptableRuntimeContext();
        const providedContext = results?.runContext || null;
        
        if (results?._isDisplayingSavedRun) {
            if (providedContext && providedContext.type === 'display') {
                return providedContext;
            }
            return {
                type: 'display',
                environment: runtimeContext.environment,
                trigger: 'saved-run',
                original: results?._savedRunContext || providedContext || null
            };
        }
        
        return providedContext || runtimeContext;
    }

    formatRunContext(runContext) {
        if (!runContext) return 'Unknown';
        
        const typeValue = String(runContext.type || 'manual');
        const label = typeValue.charAt(0).toUpperCase() + typeValue.slice(1);
        
        if (typeValue === 'display') {
            if (runContext.original && runContext.original.type) {
                const originalType = runContext.original.type;
                const originalTrigger = runContext.original.trigger ? `/${runContext.original.trigger}` : '';
                return `${label} (original: ${originalType}${originalTrigger})`;
            }
            if (runContext.trigger) {
                return `${label} (${runContext.trigger})`;
            }
            return label;
        }
        
        if (runContext.trigger) {
            return `${label} (${runContext.trigger})`;
        }
        
        return label;
    }

    sanitizeEventForRunSave(event) {
        if (!event || typeof event !== 'object') return event;
        const seen = new WeakSet();
        
        try {
            return JSON.parse(JSON.stringify(event, (key, value) => {
                if (key === '_parserConfig' && value) {
                    return {
                        name: value.name,
                        parser: value.parser,
                        dryRun: value.dryRun,
                        city: value.city,
                        calendarSearchRangeDays: value.calendarSearchRangeDays
                    };
                }
                if (key === '_existingEvent' && value) {
                    return {
                        title: value.title,
                        identifier: value.identifier,
                        startDate: value.startDate,
                        endDate: value.endDate,
                        location: value.location,
                        url: value.url
                    };
                }
                if (key === '_conflicts' && value && Array.isArray(value)) {
                    return value.map(conflict => ({
                        title: conflict.title,
                        startDate: conflict.startDate,
                        endDate: conflict.endDate,
                        identifier: conflict.identifier
                    }));
                }
                if (key === 'calendar' && value && value.title && value.identifier) {
                    return {
                        title: value.title,
                        identifier: value.identifier
                    };
                }
                if (typeof value === 'function') {
                    return undefined;
                }
                if (value && typeof value === 'object') {
                    if (seen.has(value)) {
                        return undefined;
                    }
                    seen.add(value);
                }
                return value;
            }));
        } catch (error) {
            console.log(`📱 Scriptable: Failed to serialize event "${event.title || event.name || 'unknown'}": ${error.message}`);
            return {
                title: event.title || event.name || '',
                startDate: event.startDate || null,
                endDate: event.endDate || null,
                location: event.location || event.venue || '',
                url: event.url || '',
                city: event.city || '',
                _action: event._action || null,
                _analysis: event._analysis || null,
                _mergeDiff: event._mergeDiff || null,
                _original: event._original || null
            };
        }
    }

    sanitizeEventsForRunSave(events) {
        if (!Array.isArray(events)) return [];
        return events.map(event => this.sanitizeEventForRunSave(event)).filter(Boolean);
    }

    // Detect all-day events at save-time based on DateTime patterns
    isAllDayEvent(event) {
        if (!event || !event.startDate || !event.endDate) return false;
        
        const startDate = new Date(event.startDate);
        const endDate = new Date(event.endDate);
        
        // Check if start time is 00:00:00
        const isStartMidnight = startDate.getHours() === 0 && 
                               startDate.getMinutes() === 0 && 
                               startDate.getSeconds() === 0;
        
        // Check if end time is 23:59:59 (or 23:59:00)
        const isEndLateNight = endDate.getHours() === 23 && 
                              (endDate.getMinutes() === 59 || endDate.getMinutes() === 0);
        
        // Check if it's the same day
        const isSameDay = startDate.toDateString() === endDate.toDateString();
        
        return isStartMidnight && isEndLateNight && isSameDay;
    }

    // Get calendar name for a city
    getCalendarName(city) {
        if (city && this.cities[city] && this.cities[city].calendar) {
            return this.cities[city].calendar;
        }
        // Return fallback name - system will handle missing calendar appropriately
        return `chunky-dad-${city}`;
    }

    // Get timezone for a city
    getTimezoneForCity(city) {
        if (city && this.cities[city] && this.cities[city].timezone) {
            return this.cities[city].timezone;
        }
        // NO FALLBACKS - throw error if timezone not found
        throw new Error(`No timezone configuration found for city: ${city}`);
    }

    // HTTP Adapter Implementation
    async fetchData(url, options = {}) {
        try {
            const request = new Request(url);
            request.method = options.method || 'GET';
            request.headers = {
                'User-Agent': this.config.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...options.headers
            };
            
            if (options.body) {
                request.body = options.body;
            }
            
            const response = await request.loadString();
            
            // Check response status
            const statusCode = request.response ? request.response.statusCode : 200;
            
            if (statusCode >= 400) {
                throw new Error(`HTTP ${statusCode} error from ${url}`);
            }
            
            if (response && response.length > 0) {
                return {
                    html: response,
                    url: url,
                    statusCode: statusCode,
                    headers: request.response ? request.response.headers : {}
                };
            } else {
                console.error(`📱 Scriptable: ✗ Empty response from ${url}`);
                throw new Error(`Empty response from ${url}`);
            }
            
        } catch (error) {
            const errorMessage = `📱 Scriptable: ✗ HTTP request failed for ${url}: ${error.message}`;
            console.log(errorMessage);
            throw new Error(`HTTP request failed for ${url}: ${error.message}`);
        }
    }

    // Configuration Loading
    async loadConfiguration() {
        try {
            const fm = FileManager.iCloud();
            const scriptableDir = fm.documentsDirectory();
            
            const loadConfigFile = (fileName, moduleName, missingMessage, emptyMessage) => {
                const configPath = fm.joinPath(scriptableDir, fileName);
                
                if (!fm.fileExists(configPath)) {
                    console.error(`📱 Scriptable: ✗ Configuration file not found at: ${configPath}`);
                    // List files in directory for debugging
                    try {
                        const files = fm.listContents(scriptableDir);
                        console.log(`📱 Scriptable: Files in ${scriptableDir}: ${JSON.stringify(files)}`);
                    } catch (listError) {
                        console.log(`📱 Scriptable: ✗ Failed to list directory contents: ${listError.message}`);
                    }
                    throw new Error(missingMessage);
                }
                
                const configText = fm.readString(configPath);
                
                if (!configText || configText.trim().length === 0) {
                    throw new Error(emptyMessage);
                }
                
                // Use importModule to load the JS configuration file
                const configModule = importModule(moduleName);
                return configModule || eval(configText);
            };
            
            const config = loadConfigFile(
                'scraper-input.js',
                'scraper-input',
                'Configuration file not found at iCloud Drive/Scriptable/scraper-input.js',
                'Configuration file is empty'
            );
            
            const cities = loadConfigFile(
                'scraper-cities.js',
                'scraper-cities',
                'City configuration file not found at iCloud Drive/Scriptable/scraper-cities.js',
                'City configuration file is empty'
            );
            
            config.cities = cities;
            
            // Validate configuration structure
            if (!config.parsers || !Array.isArray(config.parsers)) {
                throw new Error('Configuration missing parsers array');
            }
            
            if (!config.cities || typeof config.cities !== 'object') {
                throw new Error('Configuration missing cities data');
            }
            
            this.applyLogConfig(config);
            
            return config;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to load configuration: ${error.message}`);
            throw new Error(`Configuration loading failed: ${error.message}`);
        }
    }

    // Get existing events for a specific event (called by shared-core)
    async getExistingEvents(event) {
        try {
            // Determine calendar name from city
            const city = event.city || 'default';
            const calendarName = this.getCalendarName(city);
            const calendar = await this.getOrCreateCalendar(calendarName);
            
            // Parse dates from formatted event
            const startDate = event.startDate;
            const endDate = event.endDate;
            
            // Expand search range for conflict detection
            const searchRangeDays = Number(event._parserConfig?.calendarSearchRangeDays || 0);
            const searchStart = new Date(startDate);
            searchStart.setHours(0, 0, 0, 0);
            const searchEnd = new Date(endDate);
            searchEnd.setHours(23, 59, 59, 999);
            
            if (Number.isFinite(searchRangeDays) && searchRangeDays > 0) {
                searchStart.setDate(searchStart.getDate() - searchRangeDays);
                searchEnd.setDate(searchEnd.getDate() + searchRangeDays);
            }
            
            const existingEvents = await CalendarEvent.between(searchStart, searchEnd, [calendar]);
            return existingEvents;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to get existing events: ${error.message}`);
            return [];
        }
    }
    
    // Execute calendar actions determined by shared-core
    async executeCalendarActions(analyzedEvents, config) {
        if (!analyzedEvents || analyzedEvents.length === 0) {
            console.log('📱 Scriptable: No events to process');
            return 0;
        }

        try {
            console.log(`📱 Scriptable: Executing actions for ${analyzedEvents.length} events`);
            
            const failedEvents = [];
            const actionCounts = { merge: [], skip: [], create: [] };
            let processedCount = 0;
            
            for (const event of analyzedEvents) {
                try {
                    const city = event.city || 'default';
                    const calendarName = this.getCalendarName(city);
                    const calendar = await this.getOrCreateCalendar(calendarName);
                    
                    switch (event._action) {
                        case 'merge': {
                            actionCounts.merge.push(event.title);
                            const targetEvent = event._existingEvent;
                            
                            // Apply the final merged values (event object already contains final values)
                            targetEvent.title = event.title;
                            targetEvent.startDate = event.startDate;
                            targetEvent.endDate = event.endDate;
                            targetEvent.location = event.location;
                            targetEvent.notes = event.notes;
                            targetEvent.url = event.url;
                            
                            await targetEvent.save();
                            processedCount++;
                            break;
                        }
                            
                        case 'conflict':
                            actionCounts.skip.push(event.title);
                            break;
                            
                        case 'new':
                            actionCounts.create.push(event.title);
                            
                            await this.createCalendarEvent(event, calendar);
                            processedCount++;
                            break;
                    }
                    
                } catch (error) {
                    failedEvents.push({ title: event.title, error: error.message });
                }
            }
            
            // Log smart summary of actions and results
            const totalActions = Object.values(actionCounts).reduce((sum, arr) => sum + arr.length, 0);
            if (totalActions > 0) {
                const actionSummary = [];
                if (actionCounts.create.length > 0) actionSummary.push(`${actionCounts.create.length} created`);
                if (actionCounts.merge.length > 0) actionSummary.push(`${actionCounts.merge.length} merged`);
                if (actionCounts.skip.length > 0) actionSummary.push(`${actionCounts.skip.length} skipped`);
                
                console.log(`📱 Scriptable: ✓ Processed ${processedCount} events: ${actionSummary.join(', ')}`);
            }
            
            if (failedEvents.length > 0) {
                console.log(`📱 Scriptable: ✗ Failed to process ${failedEvents.length} events: ${failedEvents.map(f => f.title).join(', ')}`);
                // Log first error for debugging
                console.log(`📱 Scriptable: First error: ${failedEvents[0].error}`);
            }

            return processedCount;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Calendar execution error: ${error.message}`);
            throw new Error(`Calendar execution failed: ${error.message}`);
        }
    }

    // Helper method to create and save a calendar event
    async createCalendarEvent(event, calendar) {
        const calendarEvent = new CalendarEvent();
        calendarEvent.title = event.title;
        calendarEvent.startDate = event.startDate;
        calendarEvent.endDate = event.endDate;
        calendarEvent.location = event.location;
        calendarEvent.notes = event.notes;
        calendarEvent.url = event.url;
        calendarEvent.calendar = calendar;
        
        const isAllDay = this.isAllDayEvent(event);
        if (isAllDay) {
            calendarEvent.isAllDay = true;
        }
        
        await calendarEvent.save();
        const allDayNote = isAllDay ? ' (all-day)' : '';
        console.log(`📱 Scriptable: Created event "${event.title}" in ${calendar.title}${allDayNote}`);
        return calendarEvent;
    }

    async getOrCreateCalendar(calendarName) {
        try {
            // Try to find existing calendar
            const calendars = await Calendar.forEvents();
            let calendar = calendars.find(cal => cal.title === calendarName);
            
            if (!calendar) {
                // NEVER create new calendars - throw error instead
                const errorMsg = `Calendar "${calendarName}" does not exist. Please create it manually first.`;
                console.log(`📱 Scriptable: ✗ ${errorMsg}`);
                throw new Error(errorMsg);
            }
            
            return calendar;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to get calendar "${calendarName}": ${error.message}`);
            throw error;
        }
    }

    // Display/Logging Adapter Implementation
    async logInfo(message) {
        console.log(message);
    }

    async logSuccess(message) {
        console.log(message);
    }

    async logWarn(message) {
        this.warnCount += 1;
        console.warn(message);
    }

    async logError(message) {
        console.error(message);
    }

    // Results Display - Enhanced with calendar preview and comparison
    async displayResults(results) {
        try {
            // Store results for use in other methods
            this.lastResults = results;
            
            const resolvedRunContext = this.resolveRunContext(results);
            results.runContext = resolvedRunContext;
            const runContextLabel = this.formatRunContext(resolvedRunContext);
            console.log(`📱 Scriptable: Run type: ${runContextLabel}`);
            
            // First show the enhanced display features in console for debugging
            await this.displayCalendarProperties(results);
            await this.compareWithExistingCalendars(results);
            await this.displayEnrichedEvents(results);
            
            // Show console summary
            console.log('\n' + '='.repeat(60));
            console.log('🐻 BEAR EVENT SCRAPER RESULTS');
            console.log('='.repeat(60));
            console.log(`Run Type: ${runContextLabel}`);
            
            console.log(`📊 Total Events Found: ${results.totalEvents} (all events from all sources)`);
            console.log(`🐻 Raw Bear Events: ${results.rawBearEvents || 'N/A'} (after bear filtering)`);
            if (results.duplicatesRemoved > 0) {
                console.log(`🔄 Duplicates Removed: ${results.duplicatesRemoved}`);
                console.log(`🐻 Final Bear Events: ${results.bearEvents} (${results.rawBearEvents} - ${results.duplicatesRemoved} dupes)`);
            } else {
                console.log(`🐻 Final Bear Events: ${results.bearEvents} (no duplicates found)`);
            }
            console.log(`📅 Added to Calendar: ${results.calendarEvents}${results.calendarEvents === 0 ? ' (dry run/preview mode - no events written)' : ''}`);
            
            // Show event actions summary if available
            const allEvents = this.getAllEventsFromResults(results);
            if (allEvents && allEvents.length > 0) {
                const actionsCount = {
                    new: 0, add: 0, merge: 0, conflict: 0, enriched: 0
                };
                
                let hasActions = false;
                allEvents.forEach(event => {
                    if (event._action) {
                        hasActions = true;
                        const action = event._action.toLowerCase();
                        if (actionsCount.hasOwnProperty(action)) {
                            actionsCount[action]++;
                        }
                    }
                });
                
                if (hasActions) {
                    console.log('\n🎯 Event Actions:');
                    Object.entries(actionsCount).forEach(([action, count]) => {
                        if (count > 0) {
                            const actionIcon = {
                                'new': '➕', 'add': '➕', 'merge': '🔄',
                                'conflict': '⚠️', 'enriched': '✨'
                            }[action] || '❓';
                            console.log(`   ${actionIcon} ${action.toUpperCase()}: ${count}`);
                        }
                    });
                }
            }
            
            if (results.errors.length > 0) {
                console.log(`❌ Errors: ${results.errors.length}`);
                results.errors.forEach(error => console.log(`   • ${error}`));
            }
            
            console.log('\n📋 Parser Results:');
            results.parserResults.forEach(result => {
                console.log(`   • ${result.name}: ${result.bearEvents} bear events`);
            });
            
            console.log('\n' + '='.repeat(60));
            
            // Present rich UI display (may update results.calendarEvents if user executes)
            await this.presentRichResults(results);

            // Persist this run for later display (skip when showing saved runs)
            const hasAnalyzedEvents = Array.isArray(results?.analyzedEvents);
            const enabledParsers = (results?.config?.parsers || []).filter(parser => parser.enabled !== false);
            const hasEnabledParsers = enabledParsers.length > 0;
            const shouldSaveRun = !results?._isDisplayingSavedRun && hasAnalyzedEvents && hasEnabledParsers;
            const retentionDays = 30;
            if (shouldSaveRun) {
                await this.ensureRelativeStorageDirs();
                const runId = await this.saveRun(results);
                if (runId) {
                    results.savedRunId = runId;
                    results.savedRunPath = this.getRunFilePath(runId);
                }
                // Cleanup old JSON runs
                await this.cleanupOldFiles('chunky-dad-scraper/runs', {
                    maxAgeDays: retentionDays,
                    keep: (name) => !name.endsWith('.json')
                });
            } else {
                const reason = results?._isDisplayingSavedRun
                    ? 'display mode'
                    : !hasEnabledParsers
                        ? 'no enabled parsers'
                        : 'missing analyzed events';
                console.log(`📱 Scriptable: Skipping run save (${reason})`);
            }

            // Append a log file entry and cleanup logs (skip saved-run display)
            if (!results?._isDisplayingSavedRun) {
                try {
                    await this.ensureRelativeStorageDirs();
                    await this.appendLogSummary(results);
                    await this.cleanupOldFiles('chunky-dad-scraper/logs', {
                        maxAgeDays: retentionDays,
                        keep: (name) => {
                            const lower = name.toLowerCase();
                            return lower.includes('performance') || lower.endsWith('.csv');
                        }
                    });
                } catch (logErr) {
                    console.log(`📱 Scriptable: Log write/cleanup failed: ${logErr.message}`);
                }
            } else {
                console.log('📱 Scriptable: Skipping log write (display mode)');
            }

            if (!results?._isDisplayingSavedRun) {
                // Append metrics record and update summary
                try {
                    await this.ensureRelativeStorageDirs();
                    const metricsRecord = this.buildMetricsRecord(results);
                    if (metricsRecord) {
                        await this.appendMetricsRecord(metricsRecord, retentionDays);
                        await this.updateMetricsSummary(metricsRecord);
                    } else {
                        console.log('📱 Scriptable: Skipping metrics write (missing runId)');
                    }
                } catch (metricsErr) {
                    console.log(`📱 Scriptable: Metrics write failed: ${metricsErr.message}`);
                }
            }
            
        } catch (error) {
            console.log(`📱 Scriptable: Error displaying results: ${error.message}`);
        }
    }

    // Error handling with user-friendly alerts
    async showError(title, message) {
        try {
            const alert = new Alert();
            alert.title = title;
            alert.message = message;
            alert.addAction('OK');
            await alert.present();
        } catch (error) {
            console.log(`Failed to show error alert: ${error.message}`);
        }
    }

    // Enhanced Display Methods
    async displayCalendarProperties(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📅 CALENDAR SUMMARY');
        console.log('='.repeat(60));
        
        // Get all events from all parser results
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No event data available for preview');
            return;
        }

        // Get available calendars for comparison
        const availableCalendars = await Calendar.forEvents();
        
        // Get unique calendars needed
        const calendarsNeeded = new Map();
        allEvents.forEach(event => {
            const calendarName = this.getCalendarNameForDisplay(event);
            if (!calendarsNeeded.has(calendarName)) {
                const exists = availableCalendars.find(cal => cal.title === calendarName);
                calendarsNeeded.set(calendarName, {
                    name: calendarName,
                    exists: !!exists,
                    calendar: exists,
                    eventCount: 0
                });
            }
            calendarsNeeded.get(calendarName).eventCount++;
        });

        // Show calendar summary
        console.log(`\n📊 Events: ${allEvents.length}`);
        console.log(`📅 Calendars needed: ${calendarsNeeded.size}`);
        for (const [name, info] of calendarsNeeded) {
            if (info.exists) {
                console.log(`   ✅ ${name} (${info.eventCount} events)`);
            } else {
                console.log(`   ❌ ${name} (${info.eventCount} events) - create manually`);
            }
        }
        
        console.log('\n' + '='.repeat(60));
    }

    async compareWithExistingCalendars(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🔍 CALENDAR COMPARISON & CONFLICT CHECK');
        console.log('='.repeat(60));
        
        // Get all events from all parser results
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No events to compare');
            return;
        }

        const availableCalendars = await Calendar.forEvents();
        const summary = { checked: 0, missing: 0, duplicates: 0, conflicts: 0 };
        const missingCalendars = new Map();
        
        for (const event of allEvents) {
            summary.checked++;
            const calendarName = this.getCalendarNameForDisplay(event);
            const calendar = availableCalendars.find(cal => cal.title === calendarName);
            
            if (!calendar) {
                summary.missing++;
                missingCalendars.set(calendarName, (missingCalendars.get(calendarName) || 0) + 1);
                // Mark event as missing calendar for display
                event._action = 'missing_calendar';
                event._analysis = {
                    action: 'missing_calendar',
                    reason: `Calendar "${calendarName}" does not exist`,
                    calendarName: calendarName
                };
                continue;
            }
            
            try {
                // Check for existing events in the time range
                // Ensure dates are Date objects (may be strings from saved runs)
                const startDate = typeof event.startDate === 'string' ? new Date(event.startDate) : event.startDate;
                const endDate = typeof (event.endDate || event.startDate) === 'string' ? 
                    new Date(event.endDate || event.startDate) : 
                    (event.endDate || event.startDate);
                
                const searchStart = new Date(startDate);
                const searchEnd = new Date(endDate);
                searchEnd.setDate(searchEnd.getDate() + 30); // Look ahead a month
                
                const existingEvents = await CalendarEvent.between(searchStart, searchEnd, [calendar]);
                
                // Check for exact duplicates
                const duplicates = existingEvents.filter(existing => {
                    const titleMatch = existing.title === (event.title || event.name);
                    const timeMatch = Math.abs(existing.startDate.getTime() - startDate.getTime()) < 60000; // Within 1 minute
                    return titleMatch && timeMatch;
                });
                
                if (duplicates.length > 0) {
                    summary.duplicates += duplicates.length;
                    const timezone = this.getTimezoneForCity(event.city);
                    const sampleDup = duplicates[0];
                    const dupLocalTime = sampleDup.startDate.toLocaleString('en-US', { timeZone: timezone });
                    const dupUtcTime = sampleDup.startDate.toLocaleString('en-US', { timeZone: 'UTC' });
                    console.log(`⚠️  ${event.title || event.name} → ${duplicates.length} duplicate(s) in ${calendarName}`);
                    console.log(`   Example: "${sampleDup.title}" at ${dupLocalTime} (UTC: ${dupUtcTime})`);
                }
                
                // Check for time conflicts (overlapping events)
                const conflicts = existingEvents.filter(existing => {
                    const existingStart = existing.startDate.getTime();
                    const existingEnd = existing.endDate.getTime();
                    const newStart = startDate.getTime();
                    const newEnd = endDate.getTime();
                    
                    // Check for overlap
                    return (newStart < existingEnd && newEnd > existingStart);
                });
                
                if (conflicts.length > 0) {
                    summary.conflicts += conflicts.length;
                    console.log(`⏰ ${event.title || event.name} → ${conflicts.length} time conflict(s) in ${calendarName}`);
                    const timezone = this.getTimezoneForCity(event.city);
                    const shownConflicts = conflicts.slice(0, 2);
                    shownConflicts.forEach(conflict => {
                        const conflictLocalStart = conflict.startDate.toLocaleString('en-US', { timeZone: timezone });
                        const conflictLocalEnd = conflict.endDate.toLocaleString('en-US', { timeZone: timezone });
                        const conflictUtcStart = conflict.startDate.toLocaleString('en-US', { timeZone: 'UTC' });
                        const conflictUtcEnd = conflict.endDate.toLocaleString('en-US', { timeZone: 'UTC' });
                        const shouldMerge = this.shouldMergeTimeConflict(conflict, event);
                        const mergeNote = shouldMerge ? 'merge' : 'no merge';
                        console.log(`   - "${conflict.title}": ${conflictLocalStart} - ${conflictLocalEnd} (UTC: ${conflictUtcStart} - ${conflictUtcEnd}) (${mergeNote})`);
                    });
                    if (conflicts.length > shownConflicts.length) {
                        console.log(`   ...and ${conflicts.length - shownConflicts.length} more`);
                    }
                }
                
            } catch (error) {
                console.error(`❌ Failed to check calendar "${calendarName}": ${error}`);
            }
        }
        
        if (missingCalendars.size > 0) {
            const missingList = Array.from(missingCalendars.entries())
                .map(([name, count]) => `${name} (${count})`)
                .join(', ');
            console.log(`❌ Missing calendars: ${missingList}`);
        }
        
        console.log(`✅ Calendar check complete: ${summary.checked} events, ${summary.missing} missing, ${summary.duplicates} duplicates, ${summary.conflicts} conflicts`);
        console.log('\n' + '='.repeat(60));
    }

    async displayAvailableCalendars(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📅 CALENDAR STATUS');
        console.log('='.repeat(60));
        
        try {
            const availableCalendars = await Calendar.forEvents();
            
            if (availableCalendars.length === 0) {
                console.log('❌ No calendars found or failed to load');
                return;
            }
            
            // Get all events to see which calendars we need
            const allEvents = this.getAllEventsFromResults(this.lastResults);
            const neededCalendars = new Set();
            allEvents.forEach(event => {
                const calendarName = this.getCalendarNameForDisplay(event);
                neededCalendars.add(calendarName);
            });
            
            console.log(`📊 Calendars needed for events: ${neededCalendars.size}`);
            
            // Show only the calendars we need and their status
            const foundCalendars = [];
            const missingCalendars = [];
            
            neededCalendars.forEach(calendarName => {
                const exists = availableCalendars.find(cal => cal.title === calendarName);
                if (exists) {
                    foundCalendars.push(calendarName);
                } else {
                    missingCalendars.push(calendarName);
                }
            });
            
            if (foundCalendars.length > 0) {
                console.log(`\n✅ Found calendars (${foundCalendars.length}):`);
                foundCalendars.forEach(cal => console.log(`   • ${cal}`));
            }
            
            if (missingCalendars.length > 0) {
                console.log(`\n❌ Missing calendars (${missingCalendars.length}) - create manually:`);
                missingCalendars.forEach(cal => console.log(`   • ${cal}`));
            }
            
        } catch (error) {
            console.error(`❌ Failed to load calendars: ${error}`);
        }
        
        console.log('\n' + '='.repeat(60));
    }

    async displayEnrichedEvents(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🐻 ENRICHED EVENT INFORMATION');
        console.log('='.repeat(60));
        
        // Get all events from all parser results
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No events to display');
            return;
        }
        
        // Group events by action type
        const eventsByAction = {
            new: [],
            merge: [],
            conflict: [],
            other: []
        };
        
        allEvents.forEach(event => {
            const action = event._action || 'other';
            if (eventsByAction[action]) {
                eventsByAction[action].push(event);
            } else {
                eventsByAction.other.push(event);
            }
        });
        
        // Show summary by action type
        console.log(`\n📊 Event Actions Summary:`);
        console.log(`   ➕ New: ${eventsByAction.new.length} events`);
        console.log(`   🔀 Merge: ${eventsByAction.merge.length} events`);
        console.log(`   ⚠️  Conflict: ${eventsByAction.conflict.length} events`);
        if (eventsByAction.other.length > 0) {
            console.log(`   ❓ Other: ${eventsByAction.other.length} events`);
        }
        
        const detailedActions = ['merge', 'conflict'];
        const actionsToShow = detailedActions.filter(action => eventsByAction[action].length > 0);
        if (actionsToShow.length === 0 && eventsByAction.new.length > 0) {
            actionsToShow.push('new');
        }
        
        actionsToShow.forEach(action => {
            const events = eventsByAction[action];
            if (!events || events.length === 0) return;
            
            console.log(`\n${action.toUpperCase()} Events (showing 1 of ${events.length}):`);
            console.log('─'.repeat(50));
            
            const event = events[0];
            console.log(`• ${event.title || event.name}`);
            console.log(`  📍 ${event.venue || event.bar || 'TBD'} | 📱 ${this.getCalendarNameForDisplay(event)}`);
            const eventDateForDisplay = new Date(event.startDate);
            // Get timezone from city configuration instead of expecting it on the event
            const timezone = this.getTimezoneForCity(event.city);
            const localDateTime = eventDateForDisplay.toLocaleString('en-US', { timeZone: timezone });
            const utcDateTime = eventDateForDisplay.toLocaleString('en-US', { timeZone: 'UTC' });
            console.log(`  📅 ${localDateTime} (UTC: ${utcDateTime})`);
            
            if (action === 'merge' && event._mergeDiff) {
                console.log(`  🔀 Merge: ${event._mergeDiff.preserved.length} preserved, ${event._mergeDiff.updated.length} updated, ${event._mergeDiff.added.length} added`);
            } else if (action === 'conflict' && event._analysis?.reason) {
                console.log(`  ⚠️  Reason: ${event._analysis.reason}`);
            }
        });
        
        console.log('\n' + '='.repeat(60));
    }

    async displaySummaryAndActions(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY & RECOMMENDED ACTIONS');
        console.log('='.repeat(60));
        
        // Get all events from all parser results
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No event data available for summary');
            return;
        }
        
        const summary = {
            totalEvents: allEvents.length,
            cities: [...new Set(allEvents.map(e => e.city).filter(Boolean))],
            calendarsNeeded: [...new Set(allEvents.map(e => this.getCalendarNameForDisplay(e)))],
            timezones: [...new Set(allEvents.map(e => e.timezone).filter(Boolean))]
        };
        
        console.log(`📊 Events: ${summary.totalEvents} total`);
        
        if (summary.cities.length > 0) {
            console.log(`\n🌍 Cities: ${summary.cities.join(', ')}`);
        }
        
        console.log(`📅 Calendars needed: ${summary.calendarsNeeded.length}`);
        try {
            const availableCalendars = await Calendar.forEvents();
            summary.calendarsNeeded.forEach(cal => {
                const exists = availableCalendars.find(c => c.title === cal);
                console.log(`   - "${cal}" ${exists ? '(exists)' : '(will create)'}`);
            });
        } catch (error) {
            summary.calendarsNeeded.forEach(cal => {
                console.log(`   - "${cal}" (status unknown)`);
            });
        }
        
        if (summary.timezones.length > 0) {
            console.log(`\n🕐 Timezones: ${summary.timezones.join(', ')}`);
        }
        
        // Show action breakdown if events have been analyzed
        const actionsCount = {
            new: 0,
            add: 0,
            merge: 0,
            conflict: 0,
            enriched: 0,
            unknown: 0
        };
        
        let hasActions = false;
        allEvents.forEach(event => {
            if (event._action) {
                hasActions = true;
                const action = event._action.toLowerCase();
                if (actionsCount.hasOwnProperty(action)) {
                    actionsCount[action]++;
                } else {
                    actionsCount.unknown++;
                }
            }
        });
        
        if (hasActions) {
            console.log(`\n🎯 Event Actions Analysis:`);
            Object.entries(actionsCount).forEach(([action, count]) => {
                if (count > 0) {
                    const actionIcon = {
                        'new': '➕',
                        'add': '➕',
                        'merge': '🔄',
                        'conflict': '⚠️',
                        'enriched': '✨',
                        'unknown': '❓'
                    }[action] || '❓';
                    
                    console.log(`   ${actionIcon} ${action.toUpperCase()}: ${count} events`);
                }
            });
        }

        // Add explanation about deduplication if relevant
        if (results.duplicatesRemoved > 0) {
            console.log(`\n💡 About Deduplication:`);
            console.log(`   Some venues (like Bearracuda) have events listed on multiple platforms`);
            console.log(`   (e.g., both Bearracuda.com and Eventbrite). The scraper finds both`);
            console.log(`   versions but removes duplicates to avoid calendar clutter.`);
            console.log(`   This is working correctly - ${results.duplicatesRemoved} duplicates were removed.`);
        }

        console.log(`\n🎯 Recommended Actions:`);
        console.log(`   1. Review calendar properties above`);
        console.log(`   2. Check for conflicts in comparison section`);
        console.log(`   3. Verify calendar permissions and settings`);
        console.log(`   4. Set dryRun: false in config to actually add events`);
        
        console.log('\n' + '='.repeat(60));
    }
    
    async displayFullEventObjects(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🔍 FULL EVENT OBJECTS (DEBUG)');
        console.log('='.repeat(60));
        
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No events to display');
            return;
        }
        
        // Group events by action type
        const eventsByAction = {};
        allEvents.forEach(event => {
            const action = event._action || 'unprocessed';
            if (!eventsByAction[action]) {
                eventsByAction[action] = [];
            }
            eventsByAction[action].push(event);
        });
        
        // Display events grouped by action
        Object.entries(eventsByAction).forEach(([action, events]) => {
            console.log(`\n━━━ ${action.toUpperCase()} EVENTS (${events.length}) ━━━`);
            
            events.forEach((event, index) => {
                console.log(`\n[${action.toUpperCase()} ${index + 1}/${events.length}] ${event.title || event.name}`);
                console.log('─'.repeat(60));
                
                // Create a clean object for logging (remove circular references)
                const cleanEvent = JSON.parse(JSON.stringify(event, (key, value) => {
                    // Skip internal fields that might have circular references
                    if (key === '_parserConfig' && value) {
                        return { name: value.name, parser: value.parser };
                    }
                    if (key === '_existingEvent' && value) {
                        return { 
                            title: value.title, 
                            identifier: value.identifier,
                            startDate: value.startDate,
                            endDate: value.endDate,
                            notesLength: value.notes ? value.notes.length : 0
                        };
                    }
                    if (key === '_conflicts' && value && Array.isArray(value)) {
                        return value.map(c => ({
                            title: c.title,
                            startDate: c.startDate,
                            identifier: c.identifier
                        }));
                    }
                    if (key === 'placeId') {
                        return undefined; // Hide placeId from debug display
                    }
                    if (typeof value === 'function') {
                        return '[Function]';
                    }
                    return value;
                }, 2));
                
                console.log(JSON.stringify(cleanEvent, null, 2));
            });
        });
        
        console.log('\n' + '='.repeat(60));
    }

    // Rich UI presentation using WebView with HTML
    async presentRichResults(results) {
        try {
            console.log('📱 Scriptable: Presenting results UI...');
            
            // Generate HTML for rich display
            const html = await this.generateRichHTML(results);
            
            // Present using WebView
            await WebView.loadHTML(html, null, null, true);
            
            // After displaying results, prompt for calendar execution if we have analyzed events
            // Don't prompt when displaying saved runs (they should use isDryRun override instead)
            if (results.analyzedEvents && results.analyzedEvents.length > 0 && !results.calendarEvents && !results._isDisplayingSavedRun) {
                // Check if we have any events from non-dry-run parsers
                const eventsFromActiveParsers = results.analyzedEvents.filter(event => {
                    const parserConfig = results.config?.parsers?.find(p => p.name === event._parserConfig?.name);
                    const isParserDryRun = parserConfig?.dryRun === true;
                    return !isParserDryRun;
                });
                
                const globalDryRun = results.config?.config?.dryRun;
                const hasActiveEvents = eventsFromActiveParsers.length > 0;
                
                if (!globalDryRun && hasActiveEvents) {
                    console.log(`📱 Scriptable: Prompting for calendar execution (${eventsFromActiveParsers.length} events)`);
                    const executedCount = await this.promptForCalendarExecution(eventsFromActiveParsers, results.config);
                    results.calendarEvents = executedCount;
                } else {
                    const reason = globalDryRun ? 'global dry run' : 'no active events';
                    console.log(`📱 Scriptable: Skipping execution prompt (${reason})`);
                }
            } else {
                console.log('📱 Scriptable: Skipping execution prompt (conditions not met)');
            }
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to present rich UI: ${error.message}`);
            // Fallback to UITable
            try {

                await this.presentUITableFallback(results);
            } catch (tableError) {
                console.log(`📱 Scriptable: ✗ UITable fallback also failed: ${tableError.message}`);
                // Final fallback to QuickLook
                try {

                    const summary = this.createResultsSummary(results);
                    await QuickLook.present(summary, false);

                } catch (quickLookError) {
                    console.log(`📱 Scriptable: ✗ All display methods failed: ${quickLookError.message}`);
                }
            }
        }
    }

    // Generate rich HTML for WebView display
    async generateRichHTML(results) {
        const allEvents = this.getAllEventsFromResults(results);
        const availableCalendars = await Calendar.forEvents();
        
        // Detect dark mode for better bar/low-light readability
        const isDarkMode = Device.isUsingDarkAppearance();
        const runContextLabel = this.formatRunContext(results.runContext || this.resolveRunContext(results));
        const runIdLabel = results.savedRunId || results.sourceRunId || null;
        const runMetaLabel = runIdLabel
            ? `Run: ${runContextLabel} | ID: ${runIdLabel}`
            : `Run: ${runContextLabel}`;
        const shouldShowLogs = results?._isDisplayingSavedRun === true;
        const runLogInfo = shouldShowLogs ? await this.loadRunLogsForDisplay(results) : null;
        const logSectionHtml = shouldShowLogs ? this.buildRunLogSectionHtml(runLogInfo) : '';
        
        // Group events by their pre-analyzed actions (set by shared-core)
        const newEvents = [];
        const mergeEvents = [];
        const conflictEvents = [];
        
        for (const event of allEvents) {
            // Events should already have _action set by shared-core
            switch (event._action) {
                case 'new':
                    newEvents.push(event);
                    break;
                case 'merge':
                    mergeEvents.push(event);
                    break;
                case 'conflict':
                case 'key_conflict':
                case 'time_conflict':
                case 'missing_calendar':
                    conflictEvents.push(event);
                    break;
                default:
                    // Fallback for events without analysis
                    newEvents.push(event);
                    break;
            }
        }
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bear Event Scraper Results</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            /* chunky.dad brand colors - light mode */
            --primary-color: #667eea;
            --secondary-color: #ff6b6b;
            --accent-color: #764ba2;
            --text-primary: #333;
            --text-secondary: #666;
            --text-inverse: #ffffff;
            --background-primary: #ffffff;
            --background-light: #f8f9ff;
            --gradient-primary: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%);
            --border-color: rgba(102, 126, 234, 0.1);
            --card-shadow: 0 4px 15px rgba(0,0,0,0.08);
            --card-hover-shadow: 0 8px 25px rgba(102, 126, 234, 0.15);
        }

        ${isDarkMode ? `
        :root {
            /* Dark mode overrides for better bar/low-light readability */
            --primary-color: #8b9cf7;
            --secondary-color: #ff8a8a;
            --accent-color: #9575cd;
            --text-primary: #e0e0e0;
            --text-secondary: #b0b0b0;
            --text-inverse: #1a1a1a;
            --background-primary: #2d2d2d;
            --background-light: #1a1a1a;
            --gradient-primary: linear-gradient(135deg, var(--primary-color) 0%, var(--accent-color) 100%);
            --border-color: rgba(139, 156, 247, 0.2);
            --card-shadow: 0 4px 15px rgba(0,0,0,0.3);
            --card-hover-shadow: 0 8px 25px rgba(139, 156, 247, 0.25);
        }
        ` : ''}
        
        body {
            font-family: 'Poppins', sans-serif;
            margin: 0;
            padding: 20px;
            background-color: var(--background-light);
            color: var(--text-primary);
            line-height: 1.6;
        }
        
        /* Global link styles */
        a {
            color: var(--primary-color);
            text-decoration: none;
            transition: color 0.2s ease;
        }
        
        a:hover {
            color: var(--accent-color);
            text-decoration: underline;
        }
        
        .header {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            padding: 30px;
            border-radius: 15px;
            margin-bottom: 30px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            position: relative;
            overflow: hidden;
        }
        
        .header-controls {
            margin-top: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
        }
        
        .display-toggle {
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(255, 255, 255, 0.1);
            padding: 8px 16px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
        }
        
        .sfw-toggle {
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        
        .sfw-toggle input[type="checkbox"] {
            display: none;
        }
        
        .toggle-slider {
            width: 50px;
            height: 24px;
            background-color: rgba(255, 255, 255, 0.3);
            border-radius: 12px;
            position: relative;
            transition: background-color 0.3s ease;
            margin-right: 10px;
        }
        
        .toggle-slider::before {
            content: '';
            position: absolute;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background-color: white;
            top: 2px;
            left: 2px;
            transition: transform 0.3s ease;
        }
        
        .sfw-toggle input[type="checkbox"]:checked + .toggle-slider {
            background-color: rgba(255, 255, 255, 0.8);
        }
        
        .sfw-toggle input[type="checkbox"]:checked + .toggle-slider::before {
            transform: translateX(26px);
        }
        
        .toggle-label {
            color: var(--text-inverse);
            font-weight: 500;
            font-size: 14px;
        }
        
        .header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: radial-gradient(circle at 30% 70%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
                        radial-gradient(circle at 70% 30%, rgba(255, 255, 255, 0.05) 0%, transparent 50%);
            pointer-events: none;
        }
        
        .header-content {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 20px;
        }
        
        .header-logo {
            width: 80px;
            height: 80px;
            border-radius: 15px;
            transition: transform 0.3s ease;
            display: block;
            flex-shrink: 0;
        }
        
        .header-logo:hover {
            transform: scale(1.05);
        }
        
        .header h1 {
            margin: 0;
            font-size: 28px;
            position: relative;
            z-index: 1;
            font-weight: 700;
            line-height: 1.2;
            flex: 1;
        }
        
        .header-title {
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 5px;
        }
        
        .header-subtitle {
            font-size: 18px;
            font-weight: 400;
            opacity: 0.9;
        }
        
        .header-run-context {
            font-size: 12px;
            font-weight: 500;
            opacity: 0.85;
            margin-top: 6px;
        }
        
        .disclaimer {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            text-align: center;
        }
        
        .disclaimer-content {
            color: var(--text-inverse);
            font-size: 14px;
            font-weight: 500;
            opacity: 0.9;
        }
        
        .header .stats {
            display: flex;
            gap: 30px;
            margin-top: 20px;
            position: relative;
            z-index: 1;
        }
        
        .stat {
            display: flex;
            flex-direction: column;
            text-align: center;
        }
        
        .stat-value {
            font-size: 32px;
            font-weight: 700;
            text-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }
        
        .stat-label {
            font-size: 14px;
            opacity: 0.9;
            font-weight: 400;
        }
        
        .section {
            background: var(--background-primary);
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: var(--card-shadow);
            border: 1px solid var(--border-color);
        }
        
        .section-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid var(--border-color);
        }
        
        .section-icon {
            font-size: 24px;
            margin-right: 10px;
        }
        
        .section-title {
            font-size: 20px;
            font-weight: 600;
            flex: 1;
        }
        
        .section-count {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }
        
        .event-card {
            background: var(--background-primary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 16px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: var(--card-shadow);
        }
        
        .event-card:hover {
            box-shadow: var(--card-hover-shadow);
            transform: translateY(-3px);
            border-color: var(--border-color);
        }
        
        .event-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--text-primary);
            line-height: 1.3;
            font-family: 'Poppins', sans-serif;
        }
        
        .event-details {
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 14px;
            color: var(--text-secondary);
            font-family: 'Poppins', sans-serif;
        }
        
        .event-detail {
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }
        
        .event-detail span:first-child {
            font-size: 16px;
            min-width: 24px;
            text-align: center;
        }
        
        .event-metadata {
            background: var(--background-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
        }
        
        .metadata-item {
            display: flex;
            margin-bottom: 5px;
        }
        
        .metadata-label {
            font-weight: 500;
            margin-right: 8px;
            color: var(--text-secondary);
            min-width: 80px;
        }
        
        .action-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 15px;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 10px;
        }
        
        .badge-new {
            background: var(--gradient-primary);
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }
        
        .badge-new::before {
            content: "➕ ";
        }
        
        .badge-merge {
            background: linear-gradient(45deg, var(--primary-color), var(--secondary-color));
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
        }
        
        .badge-merge::before {
            content: "🔀 ";
        }
        
        .badge-conflict {
            background: var(--secondary-color);
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
        }
        
        .badge-conflict::before {
            content: "⚠️ ";
        }
        
        .badge-warning {
            background: var(--secondary-color);
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
        }
        
        .badge-warning::before {
            content: "⚠️ ";
        }
        
        .badge-error {
            background: var(--secondary-color);
            color: var(--text-inverse);
            box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
        }
        
        .badge-error::before {
            content: "❌ ";
        }
        
        .conflict-info {
            background: ${isDarkMode ? 'rgba(255, 193, 7, 0.1)' : '#fff3cd'};
            border: 1px solid ${isDarkMode ? 'rgba(255, 193, 7, 0.3)' : '#ffeaa7'};
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
            color: ${isDarkMode ? '#ffc107' : '#856404'};
        }
        
        .existing-info {
            background: ${isDarkMode ? 'rgba(23, 162, 184, 0.1)' : '#d1ecf1'};
            border: 1px solid ${isDarkMode ? 'rgba(23, 162, 184, 0.3)' : '#bee5eb'};
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
            color: ${isDarkMode ? '#17a2b8' : '#0c5460'};
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--text-secondary);
            font-family: 'Poppins', sans-serif;
        }
        
        .error-item {
            background: rgba(255, 107, 107, 0.1);
            border: 1px solid rgba(255, 107, 107, 0.3);
            border-radius: 12px;
            padding: 15px;
            margin-bottom: 10px;
            font-size: 14px;
            color: var(--secondary-color);
            font-family: 'Poppins', sans-serif;
            font-weight: 500;
        }
        
        .calendar-status {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            background: #f0f0f0;
            border-radius: 8px;
            margin-bottom: 10px;
        }
        
        .status-icon {
            font-size: 20px;
        }
        
        .notes-preview {
            background: ${isDarkMode ? '#242424' : '#f8f8f8'};
            border-left: 3px solid var(--primary-color);
            padding: 12px;
            margin-top: 10px;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-height: 280px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            color: var(--text-primary);
        }
        
        .diff-view {
            border: 1px solid var(--border-color);
            border-radius: 8px;
            background: var(--background-primary);
            position: relative;
        }
        
        .notes-preview strong {
            font-weight: 600;
            color: var(--text-primary);
        }
        
        details {
            background: ${isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.5)'};
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 5px;
            transition: all 0.2s ease;
        }
        
        details summary {
            padding: 5px 10px;
            font-weight: 500;
            user-select: none;
            outline: none;
            list-style: none;
        }
        
        details summary::-webkit-details-marker {
            display: none;
        }
        
        details summary:before {
            content: '▶';
            display: inline-block;
            margin-right: 5px;
            transition: transform 0.2s ease;
        }
        
        details[open] summary:before {
            transform: rotate(90deg);
        }
        
        details summary:hover {
            background: ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)'};
            border-radius: 5px;
        }
        
        details[open] {
            background: ${isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.8)'};
        }
        
        details[open] summary {
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 10px;
        }

        /* Event description styling for readability */
        .event-description {
            background: ${isDarkMode ? 'rgba(102, 126, 234, 0.12)' : '#f0f8ff'};
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 8px;
            margin-top: 8px;
            color: var(--text-primary);
        }

        /* Cleaner, larger image presentation */
        .event-image {
            margin: 10px 0 12px 0;
            text-align: center;
        }
        .event-image img {
            width: 100%;
            max-width: 560px;
            max-height: 340px;
            height: auto;
            border-radius: 12px;
            object-fit: cover;
            box-shadow: 0 4px 12px ${isDarkMode ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.15)'};
            border: 2px solid var(--border-color);
            transition: transform 0.2s ease;
        }
        .event-image img:hover { transform: scale(1.01); }

        /* Line-by-line diff styling - dark-mode friendly */
        .diff-line { 
            padding: 6px 8px; 
            margin: 3px 0; 
            border-left: 3px solid; 
            border-radius: 4px; 
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-all;
            max-width: 100%;
            overflow-x: auto;
        }
        .diff-meta { color: var(--text-secondary); font-size: 10px; }
        .diff-header { color: var(--text-secondary); font-size: 11px; margin-bottom: 4px; font-weight: bold; }
        .diff-sep { border-top: 1px solid var(--border-color); margin: 8px 0 4px 0; }
        .diff-added {
            background: ${isDarkMode ? 'rgba(52, 208, 88, 0.12)' : '#e6ffec'};
            border-left-color: #34d058;
            color: ${isDarkMode ? '#c8facc' : '#166534'};
        }
        .diff-removed {
            background: ${isDarkMode ? 'rgba(215, 58, 73, 0.14)' : '#ffeef0'};
            border-left-color: #d73a49;
            color: ${isDarkMode ? '#ffb3ba' : '#7f1d1d'};
        }
        .diff-context {
            background: ${isDarkMode ? 'rgba(255, 193, 7, 0.12)' : '#fff3cd'};
            border-left-color: #ffc107;
            color: ${isDarkMode ? '#ffe08a' : '#7a5e00'};
        }
        .diff-same {
            background: ${isDarkMode ? 'rgba(3, 102, 214, 0.14)' : '#f1f8ff'};
            border-left-color: #0366d6;
            color: ${isDarkMode ? '#9ecbff' : '#0b3e86'};
        }
        .diff-ignored {
            background: ${isDarkMode ? 'rgba(219, 171, 9, 0.16)' : '#fff5b4'};
            border-left-color: #dbab09;
            color: ${isDarkMode ? '#ffe79a' : '#7a5e00'};
        }
        .diff-merged {
            background: ${isDarkMode ? 'rgba(52, 208, 88, 0.14)' : '#e6ffec'};
            border-left-color: #34d058;
            color: ${isDarkMode ? '#bbf7d0' : '#166534'};
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .header {
                padding: 20px;
                margin-bottom: 20px;
            }
            
            .header h1 {
                font-size: 24px;
                font-weight: 700;
            }
            
            .header-logo {
                width: 60px;
                height: 60px;
            }
            
            .header-content {
                gap: 15px;
                flex-direction: column;
                text-align: center;
            }
            
            .header-content .header-logo {
                align-self: center;
            }
            
            .header .stats {
                flex-direction: column;
                gap: 15px;
            }
            
            .stat {
                text-align: center;
            }
            
            .controls-section {
                flex-direction: column !important;
                gap: 15px !important;
                align-items: stretch !important;
            }
            
            .search-container {
                max-width: none !important;
                order: 2;
            }
            
            .display-toggle {
                justify-content: center;
                order: 1;
            }
            
            .action-buttons {
                justify-content: center;
                order: 3;
            }
            
            .action-buttons button {
                flex: 1;
                max-width: 150px;
            }
            
            .section {
                padding: 15px;
            }
            
            .event-card {
                margin-bottom: 15px;
            }
            
            .event-title {
                font-size: 16px;
            }
            
            .event-detail {
                font-size: 13px;
                padding: 6px 0;
            }
            
            .raw-display {
                font-size: 11px;
                max-height: 200px;
            }
            
            .diff-view {
                padding: 8px !important;
            }
        }
        
        @media (max-width: 480px) {
            .header .stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }
            
            .stat:last-child {
                grid-column: 1 / -1;
            }
            
            .action-buttons {
                flex-direction: column;
            }
            
            .action-buttons button {
                max-width: none;
            }
            
            .diff-view {
                padding: 6px !important;
            }
        }
        
        details pre {
            margin: 0;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
        }
        
        .coordinates {
            font-family: monospace;
            font-size: 12px;
            color: var(--text-secondary);
        }
        
        .controls-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            align-items: center;
        }
        
        @media (max-width: 768px) {
            .controls-grid {
                grid-template-columns: 1fr;
                gap: 20px;
            }
        }
        
        .control-group {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .control-label {
            font-weight: 600;
            font-size: 16px;
            color: var(--text-primary);
            margin-bottom: 8px;
        }
        
        .control-toggle {
            display: flex;
            align-items: center;
            gap: 12px;
            justify-content: center;
        }
        
        .toggle-label {
            font-weight: 500;
            font-size: 14px;
            color: var(--text-secondary);
            transition: color 0.3s ease;
        }
        
        .modern-toggle {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 28px;
        }
        
        .modern-toggle input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, #e0e0e0, #c0c0c0);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border-radius: 28px;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 22px;
            width: 22px;
            left: 3px;
            bottom: 3px;
            background: linear-gradient(135deg, #ffffff, #f0f0f0);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border-radius: 50%;
            box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }
        
        .modern-toggle input:checked + .toggle-slider {
            background: linear-gradient(135deg, var(--primary-color), #667eea);
            box-shadow: inset 0 2px 4px rgba(102, 126, 234, 0.3);
        }
        
        .modern-toggle input:checked + .toggle-slider:before {
            transform: translateX(22px);
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
        }
        
        .modern-toggle:hover .toggle-slider {
            box-shadow: inset 0 2px 6px rgba(0,0,0,0.15);
        }
        
        .modern-toggle:hover input:checked + .toggle-slider {
            box-shadow: inset 0 2px 6px rgba(102, 126, 234, 0.4);
        }
        
        .raw-display {
            display: none;
            background: ${isDarkMode ? '#1e1e1e' : '#f8f8f8'};
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 15px;
            margin-top: 10px;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.4;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            color: var(--text-primary);
        }

        .log-details {
            margin-top: 10px;
        }

        .log-output {
            background: ${isDarkMode ? '#1e1e1e' : '#f8f8f8'};
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 15px;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.4;
            white-space: pre-wrap;
            max-height: 360px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            color: var(--text-primary);
        }

        .log-line {
            display: block;
            padding: 2px 4px;
            border-radius: 4px;
            white-space: pre-wrap;
        }

        .log-line-error {
            color: ${isDarkMode ? '#ff8a80' : '#d32f2f'};
            background: ${isDarkMode ? 'rgba(255, 138, 128, 0.15)' : 'rgba(211, 47, 47, 0.12)'};
        }

        .log-line-warn {
            color: ${isDarkMode ? '#ffcc80' : '#ef6c00'};
            background: ${isDarkMode ? 'rgba(255, 204, 128, 0.15)' : 'rgba(239, 108, 0, 0.12)'};
        }

        .log-line-success {
            color: ${isDarkMode ? '#a5d6a7' : '#2e7d32'};
            background: ${isDarkMode ? 'rgba(165, 214, 167, 0.15)' : 'rgba(46, 125, 50, 0.12)'};
        }

        .log-empty {
            color: var(--text-secondary);
            font-size: 14px;
        }
        
        .event-card.raw-mode .event-details,
        .event-card.raw-mode .event-metadata,
        .event-card.raw-mode .existing-info,
        .event-card.raw-mode .conflict-info,
        .event-card.raw-mode details:not(.raw-json-details) {
            display: none !important;
        }
        
        .event-card.raw-mode .raw-display {
            display: block;
        }
        
        .event-card.raw-mode {
            background: #1e1e1e;
            border-color: #333;
        }
        
        .event-card.raw-mode .event-title {
            color: #fff;
            font-family: monospace;
            font-size: 14px;
        }
        
        .event-card.raw-mode .action-badge {
            background: #333;
            border: 1px solid #555;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <img src="https://raw.githubusercontent.com/stanleyrya/chunky-dad/main/Rising_Star_Ryan_Head_Compressed.png" 
                 alt="chunky.dad logo" class="header-logo">
            <h1>
                <div class="header-title">chunky.dad</div>
                <div class="header-subtitle">Bear Event Scraper Results</div>
                <div class="header-run-context">${runMetaLabel}</div>
            </h1>
        </div>
        <div class="header-controls">
            <!-- Controls moved to a separate section below -->
        </div>
        <div class="stats">
            <div class="stat">
                <div class="stat-value">${results.totalEvents}</div>
                <div class="stat-label">Total Events Found</div>
            </div>
            <div class="stat">
                <div class="stat-value">${results.rawBearEvents || 'N/A'}</div>
                <div class="stat-label">Raw Bear Events</div>
            </div>
            <div class="stat">
                <div class="stat-value">${results.bearEvents}</div>
                <div class="stat-label">Final Bear Events${results.duplicatesRemoved > 0 ? ` (-${results.duplicatesRemoved} dupes)` : ''}</div>
            </div>
            <div class="stat">
                <div class="stat-value">${results.calendarEvents}</div>
                <div class="stat-label">Calendar Actions${results.calendarEvents === 0 ? ' (dry run/preview mode)' : ''}</div>
            </div>
        </div>
    </div>
    
    <div class="controls-section" style="
        background: var(--background-primary);
        border-radius: 15px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: var(--card-shadow);
    ">
        <div class="controls-grid">
            <div class="control-group">
                <div class="control-label">Display Mode</div>
                <div class="control-toggle">
                    <span class="toggle-label">Pretty</span>
                    <label class="modern-toggle">
                        <input type="checkbox" id="displayToggle" onchange="toggleDisplayMode()">
                        <span class="toggle-slider"></span>
                    </label>
                    <span class="toggle-label">Raw</span>
                </div>
            </div>
            
            <div class="control-group">
                <div class="control-label">Images</div>
                <div class="control-toggle">
                    <span class="toggle-label">Hide</span>
                    <label class="modern-toggle">
                        <input type="checkbox" id="sfwToggle" onchange="toggleImages()" checked>
                        <span class="toggle-slider"></span>
                    </label>
                    <span class="toggle-label">Show</span>
                </div>
            </div>
        </div>
    </div>
    
    <div class="controls-section" style="
        background: var(--background-primary);
        border-radius: 15px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.08);
        border: 1px solid rgba(102, 126, 234, 0.1);
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: center;
        justify-content: space-between;
    ">
        
        <div class="search-container" style="
            display: flex;
            align-items: center;
            gap: 10px;
            flex-grow: 1;
            max-width: 400px;
        ">
            <span style="font-weight: 500;">🔍</span>
            <input type="text" id="searchInput" placeholder="Search events..." onkeyup="filterEvents()" style="
                flex-grow: 1;
                padding: 8px 12px;
                border: 2px solid rgba(102, 126, 234, 0.2);
                border-radius: 8px;
                font-size: 14px;
                outline: none;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                font-family: 'Poppins', sans-serif;
                background: var(--background-primary);
            " onfocus="this.style.borderColor='var(--primary-color)'; this.style.boxShadow='0 0 0 3px rgba(102, 126, 234, 0.1)'" 
               onblur="this.style.borderColor='rgba(102, 126, 234, 0.2)'; this.style.boxShadow='none'">
            <button onclick="clearSearch()" style="
                padding: 6px 10px;
                background: var(--background-light);
                border: 1px solid rgba(102, 126, 234, 0.2);
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                font-family: 'Poppins', sans-serif;
                color: var(--text-primary);
            " onmouseover="this.style.background='var(--primary-color)'; this.style.color='var(--text-inverse)'; this.style.transform='translateY(-1px)'" 
               onmouseout="this.style.background='var(--background-light)'; this.style.color='var(--text-primary)'; this.style.transform='translateY(0)'">
                Clear
            </button>
        </div>
        
        <div class="action-buttons" style="display: flex; gap: 10px;">
            <button onclick="copyRawOutput()" style="
                padding: 8px 16px;
                background: var(--primary-color);
                color: var(--text-inverse);
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
                font-family: 'Poppins', sans-serif;
            " onmouseover="this.style.background='var(--accent-color)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 15px rgba(102, 126, 234, 0.4)'" 
               onmouseout="this.style.background='var(--primary-color)'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(102, 126, 234, 0.3)'">
                📋 Copy Raw Output
            </button>
            
            <button onclick="exportAsJSON()" style="
                padding: 8px 16px;
                background: var(--secondary-color);
                color: var(--text-inverse);
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
                font-family: 'Poppins', sans-serif;
            " onmouseover="this.style.background='#ff5252'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 15px rgba(255, 107, 107, 0.4)'" 
               onmouseout="this.style.background='var(--secondary-color)'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(255, 107, 107, 0.3)'">
                📄 Export JSON
            </button>
        </div>
    </div>
    
    ${newEvents.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">✨</span>
            <span class="section-title">New Events to Add</span>
            <span class="section-count">${newEvents.length}</span>
        </div>
        ${newEvents.map(event => this.generateEventCard(event)).join('')}
    </div>
    ` : ''}
    
    ${mergeEvents.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">🔀</span>
            <span class="section-title">Events to Merge (Adding Info)</span>
            <span class="section-count">${mergeEvents.length}</span>
        </div>
        ${mergeEvents.map(event => this.generateEventCard(event)).join('')}
    </div>
    ` : ''}
    
    ${conflictEvents.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">⚠️</span>
                            <span class="section-title">Events Requiring Review</span>
            <span class="section-count">${conflictEvents.length}</span>
        </div>
        ${conflictEvents.map(event => this.generateEventCard(event)).join('')}
    </div>
    ` : ''}
    
    ${results.errors && results.errors.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">❌</span>
            <span class="section-title">Errors</span>
            <span class="section-count">${results.errors.length}</span>
        </div>
        ${results.errors.map(error => `
            <div class="error-item">${this.escapeHtml(error)}</div>
        `).join('')}
    </div>
    ` : ''}
    
    ${allEvents.length === 0 ? `
    <div class="section">
        <div class="empty-state">
            <div style="font-size: 48px; margin-bottom: 20px;">🔍</div>
            <div>No events found to process</div>
        </div>
    </div>
    ` : ''}

    ${logSectionHtml}
    
    <script>
        function toggleDisplayMode() {
            const toggle = document.getElementById('displayToggle');
            const eventCards = document.querySelectorAll('.event-card');
            
            eventCards.forEach(card => {
                if (toggle.checked) {
                    card.classList.add('raw-mode');
                } else {
                    card.classList.remove('raw-mode');
                }
            });
        }
        
        function toggleDiffView(button, eventKey) {
            // Convert eventKey to safe ID for DOM lookups - handle both escaped and unescaped keys
            let safeEventKey = eventKey;
            
            // If the key contains escaped characters, unescape them first
            if (eventKey.includes("\\'")) {
                safeEventKey = eventKey.replace(/\\'/g, "'");
            }
            
            // Decode HTML entities before creating safe ID
            safeEventKey = safeEventKey.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            
            // Convert to safe DOM ID (same logic as in HTML generation)
            safeEventKey = safeEventKey.replace(/[^a-zA-Z0-9\-_]/g, '_');
            
            const tableView = document.getElementById('table-view-' + safeEventKey);
            const lineView = document.getElementById('line-view-' + safeEventKey);
            
            // Check current state - table view is visible if display is not 'none'
            const isTableVisible = tableView && tableView.style.display !== 'none';
            
            if (isTableVisible) {
                // Switch to line view
                if (tableView) tableView.style.display = 'none';
                if (lineView) lineView.style.display = 'block';
                button.textContent = 'Switch to Table View';
            } else {
                // Switch to table view
                if (tableView) tableView.style.display = 'block';
                if (lineView) lineView.style.display = 'none';
                button.textContent = 'Switch to Line View';
            }
        }
        
        function toggleComparisonSection(eventId) {
            // Convert eventId to safe ID for DOM lookups - handle both escaped and unescaped keys
            let safeEventId = eventId;
            
            // If the key contains escaped characters, unescape them first
            if (eventId.includes("\\'")) {
                safeEventId = eventId.replace(/\\'/g, "'");
            }
            
            // Decode HTML entities before creating safe ID
            safeEventId = safeEventId.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            
            // Convert to safe DOM ID (same logic as in HTML generation)
            safeEventId = safeEventId.replace(/[^a-zA-Z0-9\-_]/g, '_');
            
            const content = document.getElementById('comparison-content-' + safeEventId);
            const icon = document.getElementById('expand-icon-' + safeEventId);
            const diffToggle = document.getElementById('diff-toggle-' + safeEventId);
            
            if (content && content.style.display === 'none') {
                content.style.display = 'block';
                if (icon) icon.textContent = '▼';
                if (diffToggle) diffToggle.style.display = 'block';
            } else {
                if (content) content.style.display = 'none';
                if (icon) icon.textContent = '▶';
                if (diffToggle) diffToggle.style.display = 'none';
            }
        }
        
        function copyRawOutput() {
            // Get all event cards
            const eventCards = document.querySelectorAll('.event-card');
            let rawOutput = '';
            
            // Add header
            rawOutput += '🐻 BEAR EVENT SCRAPER - RAW OUTPUT\\n';
            rawOutput += '=' + '='.repeat(50) + '\\n\\n';
            
            // Add summary stats
            const totalEvents = document.querySelector('.stat-value').textContent;
            const bearEvents = document.querySelectorAll('.stat-value')[1].textContent;
            const calendarActions = document.querySelectorAll('.stat-value')[2].textContent;
            
            rawOutput += \`📊 SUMMARY:\\\\n\`;
            rawOutput += \`Total Events: \${totalEvents}\\\\n\`;
            rawOutput += \`Bear Events: \${bearEvents}\\\\n\`;
            rawOutput += \`Calendar Actions: \${calendarActions}\\\\n\\\\n\`;
            
            // Process each event
            eventCards.forEach((card, index) => {
                const title = card.querySelector('.event-title')?.textContent || 'Untitled Event';
                const rawData = card.querySelector('.raw-display')?.textContent || 'No raw data available';
                
                rawOutput += \`EVENT \${index + 1}: \${title}\\\\n\`;
                rawOutput += '-'.repeat(60) + '\\n';
                rawOutput += rawData + '\\n\\n';
            });
            
            // Copy to clipboard with fallback support
            const button = document.querySelector('button[onclick="copyRawOutput()"]');
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(rawOutput).then(() => {
                    if (button) showCopySuccess(button);
                }).catch(err => {
                    console.error('Modern clipboard failed, trying fallback: ', err);
                    copyToClipboardFallback(rawOutput, button);
                });
            } else {
                copyToClipboardFallback(rawOutput, button);
            }
        }
        
        function filterEvents() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const eventCards = document.querySelectorAll('.event-card');
            const sections = document.querySelectorAll('.section');
            let visibleCount = 0;
            
            eventCards.forEach(card => {
                const title = card.querySelector('.event-title')?.textContent.toLowerCase() || '';
                const venue = card.querySelector('.event-detail span')?.textContent.toLowerCase() || '';
                const content = card.textContent.toLowerCase();
                
                const isVisible = searchTerm === '' || 
                                title.includes(searchTerm) || 
                                venue.includes(searchTerm) || 
                                content.includes(searchTerm);
                
                if (isVisible) {
                    card.style.display = 'block';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });
            
            // Update section visibility and counts
            sections.forEach(section => {
                const visibleCards = section.querySelectorAll('.event-card[style*="block"], .event-card:not([style*="none"])').length;
                const sectionCount = section.querySelector('.section-count');
                
                if (visibleCards > 0) {
                    section.style.display = 'block';
                    if (sectionCount) {
                        sectionCount.textContent = visibleCards;
                    }
                } else {
                    section.style.display = 'none';
                }
            });
            
            // Show/hide "no results" message
            let noResultsMsg = document.getElementById('noResultsMessage');
            if (visibleCount === 0 && searchTerm !== '') {
                if (!noResultsMsg) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.id = 'noResultsMessage';
                    noResultsMsg.innerHTML = \`
                        <div style="
                            background: white;
                            border-radius: 15px;
                            padding: 40px;
                            margin-bottom: 20px;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                            text-align: center;
                            color: #666;
                        ">
                            <div style="font-size: 48px; margin-bottom: 20px;">🔍</div>
                            <h3 style="margin: 0 0 10px 0; color: #333;">No events found</h3>
                            <p style="margin: 0; font-size: 14px;">Try adjusting your search terms or clearing the search.</p>
                        </div>
                    \`;
                    document.body.appendChild(noResultsMsg);
                }
                noResultsMsg.style.display = 'block';
            } else if (noResultsMsg) {
                noResultsMsg.style.display = 'none';
            }
        }
        
        function clearSearch() {
            document.getElementById('searchInput').value = '';
            filterEvents();
        }
        
        function copyEventJSON(button) {
            const eventJSON = button.getAttribute('data-event-json');
            
            // Try modern clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(eventJSON).then(() => {
                    showCopySuccess(button);
                }).catch(err => {
                    console.error('Modern clipboard failed, trying fallback: ', err);
                    copyToClipboardFallback(eventJSON, button);
                });
            } else {
                // Fallback for older WebViews
                copyToClipboardFallback(eventJSON, button);
            }
        }
        
        function copyToClipboardFallback(text, button) {
            try {
                // Create a temporary textarea element
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                
                // Select and copy
                textArea.focus();
                textArea.select();
                
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                
                if (successful) {
                    showCopySuccess(button);
                } else {
                    throw new Error('execCommand failed');
                }
            } catch (err) {
                console.error('Fallback copy failed: ', err);
                // Show the JSON in an alert as last resort
                alert('Copy failed. Here is the JSON data:\\n\\n' + text.substring(0, 500) + (text.length > 500 ? '...' : ''));
            }
        }
        
        function showCopySuccess(button) {
            const originalText = button.innerHTML;
                                    button.innerHTML = '✅ Copied!';
                        button.style.background = 'var(--secondary-color)';
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.style.background = 'var(--primary-color)';
            }, 2000);
        }
        
        function exportAsJSON() {
            const eventCards = document.querySelectorAll('.event-card');
            const exportData = {
                timestamp: new Date().toISOString(),
                summary: {
                    totalEvents: document.querySelector('.stat-value').textContent,
                    bearEvents: document.querySelectorAll('.stat-value')[1].textContent,
                    calendarActions: document.querySelectorAll('.stat-value')[2].textContent
                },
                events: []
            };
            
            eventCards.forEach(card => {
                const title = card.querySelector('.event-title')?.textContent || 'Untitled Event';
                const rawData = card.querySelector('.raw-display')?.textContent || '';
                const action = card.querySelector('.action-badge')?.textContent || 'UNKNOWN';
                
                // Try to parse raw data for structured information
                let eventData = { title, action, rawData };
                
                // Extract key information from the card
                const eventDetails = card.querySelectorAll('.event-detail');
                eventDetails.forEach(detail => {
                    const spans = detail.querySelectorAll('span');
                    if (spans.length >= 2) {
                        const key = spans[0].textContent.trim();
                        const value = spans[1].textContent.trim();
                        
                        // Map emoji keys to readable names
                        const keyMapping = {
                            '📍': 'venue',
                            '📅': 'date',
                            '🕐': 'time',
                            '📱': 'calendar',
                            '☕': 'tea',
                            '📸': 'instagram',
                            '👥': 'facebook',
                            '🌐': 'website',
                            '🗺️': 'googleMaps',
                            '💵': 'price'
                        };
                        
                        const mappedKey = keyMapping[key] || key;
                        eventData[mappedKey] = value;
                    }
                });
                
                exportData.events.push(eventData);
            });
            
            const jsonString = JSON.stringify(exportData, null, 2);
            
            // Copy to clipboard with fallback support
            const button = document.querySelector('button[onclick="exportAsJSON()"]');
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(jsonString).then(() => {
                    if (button) {
                        const originalText = button.innerHTML;
                        button.innerHTML = '✅ JSON Copied!';
                        button.style.background = 'var(--primary-color)';
                        
                        setTimeout(() => {
                            button.innerHTML = originalText;
                            button.style.background = 'var(--secondary-color)';
                        }, 2000);
                    }
                }).catch(err => {
                    console.error('Modern clipboard failed, trying fallback: ', err);
                    copyToClipboardFallback(jsonString, button);
                });
            } else {
                copyToClipboardFallback(jsonString, button);
            }
                }
                
        function toggleImages() {
            const toggle = document.getElementById('sfwToggle');
            const imageContainers = document.querySelectorAll('.image-container');
            
            imageContainers.forEach(container => {
                if (toggle.checked) {
                    container.style.display = 'block';
                } else {
                    container.style.display = 'none';
                }
            });
        }

        function getLogLineClass(line) {
            const lower = line.toLowerCase();
            if (lower.includes('error') || lower.includes('exception') || lower.includes('failed') || lower.includes('fail')) {
                return 'log-line log-line-error';
            }
            if (lower.includes('warn')) {
                return 'log-line log-line-warn';
            }
            if (lower.includes('success') || lower.includes('saved') || lower.includes('completed')) {
                return 'log-line log-line-success';
            }
            return 'log-line';
        }

        function highlightLogOutput() {
            const logBlocks = document.querySelectorAll('.log-output');
            logBlocks.forEach(block => {
                const rawText = block.textContent || '';
                const lines = rawText.split(/\r?\n/);
                block.textContent = '';
                lines.forEach(line => {
                    const span = document.createElement('span');
                    span.className = getLogLineClass(line);
                    span.textContent = line === '' ? ' ' : line;
                    block.appendChild(span);
                });
            });
        }
        
        // Initialize image display state on page load
        document.addEventListener('DOMContentLoaded', function() {
            toggleImages();
            highlightLogOutput();
        });
    </script>
</body>
</html>
        `;
        
        return html;
    }

    buildRunLogSectionHtml(logInfo) {
        if (!logInfo) {
            return '';
        }
        const runLabel = logInfo.runId ? `run ${logInfo.runId}` : 'this run';
        if (!logInfo.exists) {
            let emptyMessage = `No logs available for ${runLabel}.`;
            if (logInfo.reason === 'missing-run-id') {
                emptyMessage = 'No run ID available for log lookup.';
            } else if (logInfo.reason === 'missing-log-file') {
                emptyMessage = `No log file found for ${runLabel}.`;
            } else if (logInfo.reason === 'empty-log-file') {
                emptyMessage = `Log file for ${runLabel} is empty.`;
            } else if (logInfo.reason === 'read-failed') {
                emptyMessage = `Log file for ${runLabel} could not be read.`;
            }
            return `
    <div class="section log-section">
        <div class="section-header">
            <span class="section-icon">LOG</span>
            <span class="section-title">Run Logs</span>
            <span class="section-count">0</span>
        </div>
        <div class="log-empty">${this.escapeHtml(emptyMessage)}</div>
    </div>
            `;
        }

        const totalLines = Number.isFinite(logInfo.totalLines) ? logInfo.totalLines : (logInfo.shownLines || 0);
        const shownLines = Number.isFinite(logInfo.shownLines) ? logInfo.shownLines : totalLines;
        const summaryLabel = logInfo.truncated
            ? `Showing last ${shownLines} of ${totalLines} lines`
            : `Showing ${totalLines} lines`;
        const logText = logInfo.text || '';

        return `
    <div class="section log-section">
        <div class="section-header">
            <span class="section-icon">LOG</span>
            <span class="section-title">Run Logs</span>
            <span class="section-count">${totalLines}</span>
        </div>
        <details class="log-details">
            <summary>${this.escapeHtml(summaryLabel)}</summary>
            <pre class="log-output">${this.escapeHtml(logText)}</pre>
        </details>
    </div>
        `;
    }
    
    // Generate HTML for individual event card
    generateEventCard(event) {
        const actionBadge = {
            'new': '<span class="action-badge badge-new">NEW</span>',
            'merge': '<span class="action-badge badge-merge">MERGE</span>',
            'conflict': '<span class="action-badge badge-warning">CONFLICT</span>',
            'missing_calendar': '<span class="action-badge badge-error">MISSING CALENDAR</span>'
        }[event._action] || '';
        
        const eventDate = new Date(event.startDate);
        const endDate = event.endDate ? new Date(event.endDate) : null;
        
        // Get timezone from city configuration instead of expecting it on the event
        const timezone = this.getTimezoneForCity(event.city);
        const timeZoneOptions = { timeZone: timezone };
        
        const dateStr = eventDate.toLocaleDateString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            ...timeZoneOptions
        });
        const timeStr = eventDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            ...timeZoneOptions
        });
        const endTimeStr = endDate ? endDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            ...timeZoneOptions
        }) : '';
        
        // Also show UTC time for verification
        const utcTimeStr = eventDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            timeZone: 'UTC'
        });
        const endUtcTimeStr = endDate ? endDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            timeZone: 'UTC'
        }) : '';
        
        // Use the final notes that will actually be saved
        const notes = event.notes || '';
        const calendarName = this.getCalendarNameForDisplay(event);
        
        let html = `
        <div class="event-card">
            ${actionBadge}
            <div class="event-title">${this.escapeHtml(event.title || event.name)}</div>
            
            <!-- Main Event Info -->
            <div class="event-details">
                ${event.venue || event.bar ? `
                    <div class="event-detail">
                        <span>📍</span>
                        <span>${this.escapeHtml(event.venue || event.bar)}</span>
                    </div>
                ` : ''}
                ${event.address ? `
                    <div class="event-detail">
                        <span>🏠</span>
                        <span>${this.escapeHtml(event.address)}</span>
                    </div>
                ` : ''}
                ${event.location ? `
                    <div class="event-detail coordinates">
                        <span>🌐</span>
                        <span>Coordinates: ${this.escapeHtml(event.location)}</span>
                    </div>
                ` : ''}
                <div class="event-detail">
                    <span>📅</span>
                    <span>${dateStr} ${timeStr}${endTimeStr ? ` - ${endTimeStr}` : ''}</span>
                </div>
                <div class="event-detail" style="font-size: 12px; color: #666; margin-left: 20px;">
                    <span>🌍</span>
                    <span>UTC: ${utcTimeStr}${endUtcTimeStr ? ` - ${endUtcTimeStr}` : ''}</span>
                </div>
                <div class="event-detail">
                    <span>📱</span>
                    <span>${this.escapeHtml(calendarName)}</span>
                </div>
                ${event.description ? `
                    <div class=\"event-detail event-description\">
                        <span>📝</span>
                        <span>${this.escapeHtml(event.description)}</span>
                    </div>
                ` : ''}
                ${event.tea ? `
                    <div class="event-detail" style="background: #e8f5e9; padding: 8px; border-radius: 5px; margin-top: 8px;">
                        <span>☕</span>
                        <span style="font-style: italic;">${this.escapeHtml(event.tea)}</span>
                    </div>
                ` : ''}
                ${event.image ? `
                    <div class=\"event-image\">
                        <a href=\"${this.escapeHtml(event.image)}\" target=\"_blank\" rel=\"noopener\" style=\"color: var(--primary-color); font-weight: 500;\">View Full Image</a>
                        <div class=\"image-container\" style=\"margin-top: 8px; display: block;\">
                            <img src=\"${this.escapeHtml(event.image)}\" alt=\"Event Image\" onerror=\"this.style.display='none'\">
                        </div>
                    </div>
                ` : ''}
                ${event.instagram ? `
                    <div class="event-detail">
                        <span>📸</span>
                        <span><a href="${this.escapeHtml(event.instagram)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Instagram</a></span>
                    </div>
                ` : ''}
                ${event.facebook ? `
                    <div class="event-detail">
                        <span>👥</span>
                        <span><a href="${this.escapeHtml(event.facebook)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Facebook</a></span>
                    </div>
                ` : ''}
                ${event.ticketUrl ? `
                    <div class="event-detail">
                        <span>🎟️</span>
                        <span><a href="${this.escapeHtml(event.ticketUrl)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Tickets</a></span>
                    </div>
                ` : ''}
                ${event.website ? `
                    <div class="event-detail">
                        <span>🌐</span>
                        <span><a href="${this.escapeHtml(event.website)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Website</a></span>
                    </div>
                ` : ''}
                ${event.url && event.url !== event.website ? `
                    <div class="event-detail">
                        <span>🔗</span>
                        <span><a href="${this.escapeHtml(event.url)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Event Link</a></span>
                    </div>
                ` : ''}
                ${event.googleMapsLink ? `
                    <div class="event-detail">
                        <span>🗺️</span>
                        <span><a href="${this.escapeHtml(event.googleMapsLink)}" target="_blank" rel="noopener" style="color: var(--primary-color);">Google Maps</a></span>
                    </div>
                ` : ''}
                ${event.price ? `
                    <div class="event-detail">
                        <span>💵</span>
                        <span>${this.escapeHtml(event.price)}</span>
                    </div>
                ` : ''}
                
                <!-- Calendar Notes Preview -->
                ${notes ? `
                    <details style="margin-top: 10px;">
                        <summary style="cursor: pointer; font-size: 13px; color: #007aff; padding: 5px;">📝 Calendar Notes Preview</summary>
                        <div class="notes-preview">
                            ${(() => {
                                // Parse and format notes for better readability
                                const lines = notes.split('\n');
                                let formattedHtml = '';
                                
                                lines.forEach(line => {
                                    const trimmed = line.trim();
                                    if (trimmed === '') {
                                        formattedHtml += '<br>';
                                        return;
                                    }
                                    
                                    const colonIndex = line.indexOf(':');
                                    if (colonIndex > 0) {
                                        // Key-value metadata line
                                        const key = line.substring(0, colonIndex).trim();
                                        const value = line.substring(colonIndex + 1).trim();
                                        formattedHtml += `<div style="margin: 2px 0;"><strong style="color: #666;">${this.escapeHtml(key)}:</strong> ${this.escapeHtml(value)}</div>`;
                                    } else {
                                        // Freeform description line
                                        formattedHtml += `<div style="margin: 2px 0;">${this.escapeHtml(line)}</div>`;
                                    }
                                });
                                
                                return formattedHtml || '<em>No notes</em>';
                            })()}
                        </div>
                    </details>
                ` : ''}
            </div>
            
            <!-- Show comparison for all non-new events with original data -->
            ${event._original && event._action !== 'new' ? (() => {
                const hasDifferences = this.hasEventDifferences(event);
                const eventId = event.key || `event-${Math.random().toString(36).substr(2, 9)}`;
                // Decode HTML entities before creating safe ID
                const decodedEventId = eventId.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                const safeEventId = decodedEventId.replace(/[^a-zA-Z0-9\-_]/g, '_'); // Create safe ID for DOM elements
                const escapedEventId = decodedEventId.replace(/'/g, "\\'"); // Escape single quotes for JavaScript
                const isExpanded = false; // Start collapsed; expand on click
                
                return `
                <div style="margin-top: 15px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; cursor: pointer;"
                         onclick="toggleComparisonSection('${escapedEventId}')">
                        <h4 style="margin: 0; font-size: 14px;">
                            <span id="expand-icon-${safeEventId}" style="display: inline-block; width: 20px; transition: transform 0.2s;">
                                ${isExpanded ? '▼' : '▶'}
                            </span>
                            📊 ${event._action === 'conflict' ? 'Conflict Resolution' : 'Merge Comparison'}
                            ${hasDifferences ? '<span style="color: #ff9500; font-size: 12px; margin-left: 8px;">• Has changes</span>' : ''}
                        </h4>
                        <button onclick="event.stopPropagation(); toggleDiffView(this, '${escapedEventId}');" 
                                style="padding: 4px 10px; font-size: 11px; background: var(--primary-color); color: var(--text-inverse); border: none; border-radius: 8px; cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 500; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3); ${!isExpanded ? 'display: none;' : ''}"
                                id="diff-toggle-${safeEventId}">
                            Switch to Line View
                        </button>
                    </div>
                    
                    <div id="comparison-content-${safeEventId}" style="${!isExpanded ? 'display: none;' : ''}">
                    <!-- Simple three-object comparison -->
                    <div style="margin-bottom: 10px;">
                        <div style="font-size: 12px; color: #666; margin-bottom: 5px;">
                            📊 <strong>Scraper:</strong> ${Object.keys(event._original?.scraper || {}).length} fields |
                            📅 <strong>Calendar:</strong> ${Object.keys(event._original?.calendar || {}).length} fields |
                            🔀 <strong>Merged:</strong> ${Object.keys(event._original?.merged || {}).length} fields
                        </div>
                    </div>
                    
                    <!-- Table view (default) -->
                    <div id="table-view-${safeEventId}" class="diff-view" style="display: block; padding: 10px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                            <div style="font-size: 12px; color: #666;">
                                <strong>📊 Field-by-Field Comparison</strong>
                                <div style="font-size: 10px; margin-top: 2px; color: #888;">
                                    Shows how each field will be merged between existing and new event data
                                </div>
                            </div>
                            <button onclick="copyEventJSON(this)" 
                                    style="padding: 4px 8px; font-size: 11px; background: var(--primary-color); color: var(--text-inverse); border: none; border-radius: 8px; cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 500; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);"
                                    data-event-json='${this.escapeHtml(JSON.stringify(event, (key, value) => {
                                        if (key === '_parserConfig' && value) {
                                            return { name: value.name, parser: value.parser };
                                        }
                                        if (key === '_existingEvent' && value) {
                                            return { title: value.title, identifier: value.identifier };
                                        }
                                        if (key === '_conflicts' && value && Array.isArray(value)) {
                                            return value.map(c => ({
                                                title: c.title,
                                                startDate: c.startDate,
                                                identifier: c.identifier
                                            }));
                                        }
                                        if (key === 'placeId') {
                                            return undefined; // Hide placeId from debug display
                                        }
                                        if (typeof value === 'function') {
                                            return '[Function]';
                                        }
                                        return value;
                                    }, 2))}'>
                                📋 Copy JSON
                            </button>
                        </div>
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse; table-layout: auto;">
                            <tr>
                                <th style="text-align: left; padding: 5px; border-bottom: 1px solid var(--border-color); word-wrap: break-word; overflow-wrap: break-word; color: var(--text-primary);">Field</th>
                                <th style="text-align: left; padding: 5px; border-bottom: 1px solid var(--border-color); word-wrap: break-word; overflow-wrap: break-word; color: var(--text-primary);">Existing Event</th>
                                <th style="text-align: center; padding: 5px; border-bottom: 1px solid var(--border-color); word-wrap: break-word; overflow-wrap: break-word; color: var(--text-primary);">Flow</th>
                                <th style="text-align: left; padding: 5px; border-bottom: 1px solid var(--border-color); word-wrap: break-word; overflow-wrap: break-word; color: var(--text-primary);">New Event</th>
                                <th style="text-align: left; padding: 5px; border-bottom: 1px solid var(--border-color); word-wrap: break-word; overflow-wrap: break-word; color: var(--text-primary);">Result</th>
                            </tr>
                            ${this.generateComparisonRows(event)}
                        </table>
                    </div>
                    
                    <!-- Line view (hidden by default) -->
                    <div id="line-view-${safeEventId}" class="diff-view" style="display: none; padding: 10px;">
                        <div style="margin-bottom: 12px;">
                            <strong style="font-size: 12px; color: #666;">📝 Line-by-Line Diff</strong>
                            <div style="font-size: 10px; margin-top: 2px; color: #888;">
                                Git-style diff showing additions (+), deletions (-), and unchanged (=) fields
                            </div>
                        </div>
                        ${this.generateLineDiffView(event)}
                    </div>
                    </div>
                </div>
                `;
            })() : ''}
            
            <!-- Simplified metadata -->
            ${event._action === 'conflict' && event._conflicts ? `
                <div class="conflict-info">
                    <strong>⚠️ Overlapping Events:</strong> ${event._conflicts.length} event(s) at same time
                    <div style="margin-top: 10px;">
                    ${event._conflicts.map(conflict => {
                        const shouldMerge = event._conflictAnalysis?.find(a => a.event === conflict)?.shouldMerge;
                        return `
                        <div style="background: ${shouldMerge ? '#d4edda' : '#f8d7da'}; padding: 8px; border-radius: 5px; margin-bottom: 5px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong>"${this.escapeHtml(conflict.title)}"</strong>
                                    <div style="font-size: 12px; color: #666; margin-top: 2px;">
                                        ${(() => {
                                            // Get timezone from city configuration instead of expecting it on the conflict
                                            const timezone = this.getTimezoneForCity(event.city);
                                            return new Date(conflict.startDate).toLocaleString('en-US', { timeZone: timezone });
                                        })()}
                                    </div>
                                </div>
                                <div style="font-size: 12px; font-weight: 600; color: ${shouldMerge ? '#155724' : '#721c24'};">
                                    ${shouldMerge ? '✓ Will Merge' : '✗ Different Event'}
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                    </div>
                </div>
            ` : ''}
            
            ${event._action === 'missing_calendar' ? `
                <div class="conflict-info">
                    <strong>Calendar "${this.escapeHtml(calendarName)}" not found!</strong>
                    <br>Please create this calendar manually before running the scraper.
                </div>
                        ` : ''}
            
            <div class="raw-display">
                <pre style="font-size: 11px; background: #333; color: #fff; padding: 10px; border-radius: 5px; overflow-x: auto;">${this.escapeHtml(JSON.stringify(event, (key, value) => {
                    // Keep full object for debugging, only filter out circular references and functions
                    if (key === '_parserConfig' && value) {
                        return { name: value.name, parser: value.parser };
                    }
                    if (key === '_existingEvent' && value) {
                        return { title: value.title, identifier: value.identifier };
                    }
                    if (key === '_conflicts' && value && Array.isArray(value)) {
                        return value.map(c => ({
                            title: c.title,
                            startDate: c.startDate,
                            identifier: c.identifier
                        }));
                    }
                    if (key === 'placeId') {
                        return undefined; // Hide placeId from debug display
                    }
                    if (typeof value === 'function') {
                        return '[Function]'; // Show functions exist but don't break JSON
                    }
                    return value;
                }, 2))}</pre>
                <div style="margin-top: 8px; text-align: right;">
                    <button onclick="copyEventJSON(this)" 
                            style="padding: 4px 8px; font-size: 11px; background: var(--primary-color); color: var(--text-inverse); border: none; border-radius: 8px; cursor: pointer; font-family: 'Poppins', sans-serif; font-weight: 500; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);"
                            data-event-json='${this.escapeHtml(JSON.stringify(event, (key, value) => {
                                if (key === '_parserConfig' && value) {
                                    return { name: value.name, parser: value.parser };
                                }
                                if (key === '_existingEvent' && value) {
                                    return { title: value.title, identifier: value.identifier };
                                }
                                if (key === '_conflicts' && value && Array.isArray(value)) {
                                    return value.map(c => ({
                                        title: c.title,
                                        startDate: c.startDate,
                                        identifier: c.identifier
                                    }));
                                }
                                if (key === 'placeId') {
                                    return undefined; // Hide placeId from debug display
                                }
                                if (typeof value === 'function') {
                                    return '[Function]';
                                }
                                return value;
                            }, 2))}'>
                        📋 Copy JSON
                    </button>
                </div>
            </div>
        </div>
        `;
        
        return html;
    }
    
    // Helper to escape HTML
    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.toString().replace(/[&<>"']/g, m => map[m]);
    }

    // Fallback to UITable if WebView fails
    async presentUITableFallback(results) {
        try {
            const table = new UITable();
        table.showSeparators = true;
            
            // Header row
            const headerRow = new UITableRow();
            headerRow.isHeader = true;
            headerRow.height = 50;
            
            const headerCell = headerRow.addText('🐻 Bear Event Scraper Results');
            headerCell.titleFont = Font.boldSystemFont(18);
            headerCell.titleColor = Color.white();
            headerCell.backgroundColor = Color.brown();
            
            table.addRow(headerRow);
            
            // Summary section
            const summaryRow = new UITableRow();
            summaryRow.height = 80;
            
            const runContextLabel = this.formatRunContext(results.runContext || this.resolveRunContext(results));
            const deduplicationInfo = results.duplicatesRemoved > 0 ? 
                `\n🔄 Duplicates removed: ${results.duplicatesRemoved}` : '';
            const summaryText = `Run Type: ${runContextLabel}
📊 Total Events: ${results.totalEvents}${deduplicationInfo}
🐻 Bear Events: ${results.bearEvents}
📅 Added to Calendar: ${results.calendarEvents}
${results.errors.length > 0 ? `❌ Errors: ${results.errors.length}` : '✅ No errors'}`;
            
            const summaryCell = summaryRow.addText(summaryText);
            summaryCell.titleFont = Font.systemFont(14);
            summaryCell.subtitleColor = Color.gray();
            
            table.addRow(summaryRow);
            
            // Parser results section
            if (results.parserResults && results.parserResults.length > 0) {
                const parserHeaderRow = new UITableRow();
                parserHeaderRow.height = 40;
                
                const parserHeaderCell = parserHeaderRow.addText('📋 Parser Results');
                parserHeaderCell.titleFont = Font.boldSystemFont(16);
                parserHeaderCell.titleColor = Color.blue();
                
                table.addRow(parserHeaderRow);
                
                results.parserResults.forEach(result => {
                    const parserRow = new UITableRow();
                    parserRow.height = 50;
                    
                    const parserCell = parserRow.addText(`${result.name}`);
                    parserCell.titleFont = Font.systemFont(14);
                    parserCell.subtitleText = `${result.bearEvents} bear events found`;
                    parserCell.subtitleColor = Color.gray();
                    
                    table.addRow(parserRow);
                });
            }
            
            // Events section
            const allEvents = this.getAllEventsFromResults(results);
            if (allEvents && allEvents.length > 0) {
                const eventsHeaderRow = new UITableRow();
                eventsHeaderRow.height = 40;
                
                const eventsHeaderCell = eventsHeaderRow.addText('🎉 Found Events');
                eventsHeaderCell.titleFont = Font.boldSystemFont(16);
                eventsHeaderCell.titleColor = Color.green();
                
                table.addRow(eventsHeaderRow);
                
                allEvents.slice(0, 10).forEach((event, i) => { // Show first 10 events
                    const eventRow = new UITableRow();
                    eventRow.height = 60;
                    
                    const eventCell = eventRow.addText(event.title || event.name || `Event ${i + 1}`);
                    eventCell.titleFont = Font.systemFont(14);
                    
                    const subtitle = [];
                    if (event.venue || event.bar) {
                        subtitle.push(`📍 ${event.venue || event.bar}`);
                    }
                    if (event.day || event.time) {
                        subtitle.push(`📅 ${event.day || ''} ${event.time || ''}`.trim());
                    }
                    const calendarName = this.getCalendarNameForDisplay(event);
                    if (calendarName) {
                        subtitle.push(`📱 ${calendarName}`);
                    }
                    
                    eventCell.subtitleText = subtitle.join(' • ') || 'Event details';
                    eventCell.subtitleColor = Color.gray();
                    
                    table.addRow(eventRow);
                });
                
                if (allEvents.length > 10) {
                    const moreRow = new UITableRow();
                    moreRow.height = 40;
                    
                    const moreCell = moreRow.addText(`... and ${allEvents.length - 10} more events`);
                    moreCell.titleFont = Font.italicSystemFont(12);
                    moreCell.titleColor = Color.gray();
                    
                    table.addRow(moreRow);
                }
            }
            
            // Errors section
            if (results.errors && results.errors.length > 0) {
                const errorsHeaderRow = new UITableRow();
                errorsHeaderRow.height = 40;
                
                const errorsHeaderCell = errorsHeaderRow.addText('❌ Errors');
                errorsHeaderCell.titleFont = Font.boldSystemFont(16);
                errorsHeaderCell.titleColor = Color.red();
                
                table.addRow(errorsHeaderRow);
                
                results.errors.slice(0, 5).forEach(error => { // Show first 5 errors
                    const errorRow = new UITableRow();
                    errorRow.height = 50;
                    
                    const errorCell = errorRow.addText(error);
                    errorCell.titleFont = Font.systemFont(12);
                    errorCell.titleColor = Color.red();
                    
                    table.addRow(errorRow);
                });
            }
            
            // Actions section
            const actionsRow = new UITableRow();
            actionsRow.height = 80;
            
            const actionsText = `🎯 Next Steps:
• Review calendar conflicts above
• Check calendar permissions
• Set dryRun: false to add events
• Verify timezone settings`;
            
            const actionsCell = actionsRow.addText(actionsText);
            actionsCell.titleFont = Font.systemFont(12);
            actionsCell.titleColor = Color.blue();
            
            table.addRow(actionsRow);
            
            await table.present(false); // Present in normal mode (not fullscreen)
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to present UITable: ${error.message}`);
            throw error;
        }
    }

    // Helper method to create a text summary for QuickLook
    createResultsSummary(results) {
        const lines = [];
        const runContextLabel = this.formatRunContext(results.runContext || this.resolveRunContext(results));
        lines.push('🐻 BEAR EVENT SCRAPER RESULTS');
        lines.push('='.repeat(40));
        lines.push('');
        lines.push(`Run Type: ${runContextLabel}`);
        lines.push('');
        lines.push(`📊 Total Events Found: ${results.totalEvents} (all events from all sources)`);
        lines.push(`🐻 Raw Bear Events: ${results.rawBearEvents || 'N/A'} (after bear filtering)`);
        if (results.duplicatesRemoved > 0) {
            lines.push(`🔄 Duplicates Removed: ${results.duplicatesRemoved}`);
            lines.push(`🐻 Final Bear Events: ${results.bearEvents} (${results.rawBearEvents} - ${results.duplicatesRemoved} dupes)`);
        } else {
            lines.push(`🐻 Final Bear Events: ${results.bearEvents} (no duplicates found)`);
        }
        lines.push(`📅 Added to Calendar: ${results.calendarEvents}${results.calendarEvents === 0 ? ' (dry run/preview mode - no events written)' : ''}`);
        
        if (results.errors && results.errors.length > 0) {
            lines.push(`❌ Errors: ${results.errors.length}`);
        }
        
        lines.push('');
        lines.push('📋 Parser Results:');
        if (results.parserResults) {
            results.parserResults.forEach(result => {
                lines.push(`  • ${result.name}: ${result.bearEvents} bear events`);
            });
        }
        
        const allEvents = this.getAllEventsFromResults(results);
        if (allEvents && allEvents.length > 0) {
            lines.push('');
            lines.push('🎉 Found Events:');
            allEvents.slice(0, 5).forEach((event, i) => {
                const title = event.title || event.name || `Event ${i + 1}`;
                const venue = event.venue || event.bar || '';
                const calendarName = this.getCalendarNameForDisplay(event);
                lines.push(`  • ${title}`);
                if (venue) lines.push(`    📍 ${venue}`);
                if (calendarName) lines.push(`    📱 ${calendarName}`);
            });
            
            if (allEvents.length > 5) {
                lines.push(`  ... and ${allEvents.length - 5} more events`);
            }
        }
        
        if (results.errors && results.errors.length > 0) {
            lines.push('');
            lines.push('❌ Errors:');
            results.errors.slice(0, 3).forEach(error => {
                lines.push(`  • ${error}`);
            });
        }
        
        lines.push('');
        lines.push('🎯 Next Steps:');
        lines.push('  • Review calendar conflicts');
        lines.push('  • Check calendar permissions');
        lines.push('  • Set dryRun: false to add events');
        
        return lines.join('\n');
    }

    // Helper method to extract all events from parser results
    getAllEventsFromResults(results) {
        // Events must be analyzed to have action types - no fallback to raw parser results
        if (!results || !results.analyzedEvents || !Array.isArray(results.analyzedEvents)) {
            throw new Error('No analyzed events available - event analysis must succeed for the system to function');
        }
        
        let events = results.analyzedEvents;
        
        // If this is from a saved run, convert date strings to Date objects
        if (results && results._isDisplayingSavedRun && events.length > 0) {
            events = events.map(event => {
                const convertedEvent = { ...event };
                if (typeof convertedEvent.startDate === 'string') {
                    convertedEvent.startDate = new Date(convertedEvent.startDate);
                }
                if (typeof convertedEvent.endDate === 'string') {
                    convertedEvent.endDate = new Date(convertedEvent.endDate);
                }
                return convertedEvent;
            });
        }
        
        return events;
    }

    // Helper method to determine if time conflicts should be merged
    shouldMergeTimeConflict(existingEvent, newEvent) {
        // Check if both events are similar enough to be the same event
        const existingTitle = existingEvent.title.toLowerCase().trim();
        
        // For new events, check both the current title and original title (if title was overridden)
        const newTitle = (newEvent.title || newEvent.name || '').toLowerCase().trim();
        const newOriginalTitle = (newEvent.originalTitle || '').toLowerCase().trim();
        
        console.log(`📱 Scriptable: Checking merge eligibility:`);
        console.log(`   Existing: "${existingTitle}"`);
        console.log(`   New: "${newTitle}"`);
        if (newOriginalTitle) {
            console.log(`   New (original): "${newOriginalTitle}"`);
        }
        
        // Generic pattern detection for events with complex text formatting
        // This helps merge events that have variations like "A>B>C", "A-B-C", "A B C"
        const hasComplexPattern = (text) => {
            // Check if text has letters separated by special characters
            return /[a-z][\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+[a-z]/i.test(text);
        };
        
        const normalizeComplexText = (text) => {
            return text
                // Replace sequences of special chars between letters with a single hyphen
                .replace(/([a-z])[\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+([a-z])/gi, '$1-$2')
                // Remove trailing special characters after words
                .replace(/([a-z])[\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\,\.]+(?=\s|$)/gi, '$1')
                // Collapse multiple spaces/hyphens into single hyphen
                .replace(/[\s\-]+/g, '-')
                // Remove leading/trailing hyphens
                .replace(/^-+|-+$/g, '');
        };
        
        // Check if both titles have complex patterns that normalize to the same value
        if (hasComplexPattern(existingTitle) || hasComplexPattern(newTitle) || hasComplexPattern(newOriginalTitle)) {
            const normalizedExisting = normalizeComplexText(existingTitle);
            const normalizedNew = normalizeComplexText(newTitle);
            const normalizedNewOriginal = normalizeComplexText(newOriginalTitle);
            
            if (normalizedExisting === normalizedNew || normalizedExisting === normalizedNewOriginal) {
                console.log(`📱 Scriptable: Complex pattern match detected - should merge:`);
                console.log(`   Normalized existing: "${normalizedExisting}"`);
                console.log(`   Normalized new: "${normalizedNew}"`);
                return true;
            }
        }
        
        // Check for exact title matches (case insensitive) - check both titles
        if (existingTitle === newTitle || (newOriginalTitle && existingTitle === newOriginalTitle)) {
            console.log(`📱 Scriptable: Exact title match - should merge: "${existingEvent.title}" vs "${newTitle}"`);
            return true;
        }
        
        console.log(`📱 Scriptable: No merge criteria met`);
        return false;
    }

    // Helper method to calculate title similarity
    calculateTitleSimilarity(title1, title2) {
        // Simple Jaccard similarity based on words
        const words1 = new Set(title1.split(/\s+/));
        const words2 = new Set(title2.split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    // Helper to get calendar name for display purposes only
    getCalendarNameForDisplay(event) {
        const city = event.city || 'default';
        return this.getCalendarName(city);
    }
    
    // Check if event has actual differences to show
    hasEventDifferences(event) {
        if (!event._original) return false;
        
        // Get all fields that would be included in the calendar event, using the same logic as formatEventNotes
        const fieldsToCheck = this.getFieldsForComparison(event);
        
        for (const field of fieldsToCheck) {
            // Skip notes field as it's a computed field that combines other fields
            if (field === 'notes') continue;
            
            let newValue = event._original.scraper[field] || '';
            let existingValue = event._original.calendar?.[field] || '';
            
            // Skip empty fields
            if (!newValue && !existingValue) continue;
            
            // Check for differences
            if (newValue !== existingValue) {
                return true;
            }
        }
        
        return false;
    }

    // Get all fields that should be compared/displayed - check ALL fields except underscore fields and functions
    getFieldsForComparison(event) {
        // Get all fields from both new and existing events
        const allFields = new Set();
        
        // Use the same exclusion logic as formatEventNotes in shared-core.js
        // These are fields that are NOT saved to calendar notes and should NOT be displayed
        const excludeFields = new Set([
            'title', 'startDate', 'endDate', 'location', 'coordinates', 'notes',
            'isBearEvent', 'source', 'city', 'setDescription', '_analysis', '_action', 
            '_existingEvent', '_existingKey', '_conflicts', '_parserConfig', '_fieldPriorities',
            '_original', '_mergeInfo', '_changes', '_mergeDiff',
            'originalTitle', 'name', // These are usually duplicates of title
            // Scriptable-specific properties that shouldn't be in notes
            'identifier', 'availability', 'timeZone', 'calendar', 'addRecurrenceRule',
            'removeAllRecurrenceRules', 'save', 'remove', 'presentEdit', '_staticFields',
            // Location-specific fields that shouldn't be in notes (used internally)
            'placeId'
        ]);
        
        // Helper function to check if a field should be included
        const shouldIncludeField = (obj, field) => {
            if (field.startsWith('_')) return false;
            if (typeof obj[field] === 'function') return false;
            if (excludeFields.has(field)) return false;
            return true;
        };
        
        // Add fields from scraper event
        if (event._original?.scraper) {
            Object.keys(event._original.scraper).forEach(field => {
                if (shouldIncludeField(event._original.scraper, field)) {
                    allFields.add(field);
                }
            });
        }
        
        // Add fields from calendar event
        if (event._original?.calendar) {
            Object.keys(event._original.calendar).forEach(field => {
                if (shouldIncludeField(event._original.calendar, field)) {
                    allFields.add(field);
                }
            });
        }
        
        // Add fields from merged event
        if (event._original?.merged) {
            Object.keys(event._original.merged).forEach(field => {
                if (shouldIncludeField(event._original.merged, field)) {
                    allFields.add(field);
                }
            });
        }
        
        // Add fields from final event
        Object.keys(event).forEach(field => {
            if (shouldIncludeField(event, field)) {
                allFields.add(field);
            }
        });
        
        // Convert to array and sort with logical grouping
        const fieldArray = Array.from(allFields);
        
        // Define field priority order - group related fields together
        // Prefer canonical keys
        const fieldPriority = {
            // Core event info - keep name fields together
            'title': 1,
            'shortName': 2,
            
            'description': 5,
            'tea': 6,              // alias for description (kept if description missing)
            'info': 7,             // alias for description (kept if description missing)
            
            // Date/Time fields - keep start/end times together
            'startDate': 10,
            'endDate': 11,
            'date': 12,
            'day': 13,
            'time': 14,
            'startTime': 15,
            'endTime': 16,
            
            // Location fields
            'venue': 20,
            'bar': 20,          // alias for venue
            'location': 20,     // alias for venue
            'host': 20,         // alias for venue
            'address': 21,
            // Note: city is now excluded as it shouldn't be saved to calendar
            
            // Contact/Social fields
            'website': 30,
            'url': 38,             // main event URL (separate from website)
            'facebook': 31,
            'instagram': 32,
            'twitter': 33,
            'phone': 34,
            'email': 35,
            'googleMapsLink': 36,  // canonical Google Maps
            'gmaps': 36,           // alias fallback
            'ticketUrl': 37,       // ticket purchase links
            
            // Event details
            'price': 40,
            'cover': 40,        // alias for price
            'cost': 40,         // alias for price
            'category': 41,
            'type': 42,
            'eventtype': 42,    // alias for type
            'tags': 43,
            
            // Calendar specific - move notes to end since it's computed
            'calendar': 50,
            'calendarId': 51,
            'identifier': 52,
            
            // Debug fields
            'debugcity': 60,
            'debugsource': 61,
            'debugtimezone': 62,
            'debugimage': 63,
            
            // Computed fields should be last - notes is combination of other fields
            'notes': 99,
            
            // Other fields get default priority
        };
        
        return fieldArray.sort((a, b) => {
            const priorityA = fieldPriority[a] || 100;
            const priorityB = fieldPriority[b] || 100;
            
            // If same priority, sort alphabetically
            if (priorityA === priorityB) {
                return a.localeCompare(b);
            }
            
            return priorityA - priorityB;
        });
    }
    
    // Generate comparison rows for conflict display
    generateComparisonRows(event) {
        if (!event._original) return '';
        
        // Use the same field logic as what goes into calendar notes
        const fieldsToCompare = this.getFieldsForComparison(event);
        const rows = [];
        
        fieldsToCompare.forEach(field => {
            // Skip notes field as it's a computed field that combines other fields
            // This makes the comparison confusing and it's often broken
            if (field === 'notes') return;
            
            // Get the actual scraped value - don't default to empty string yet
            let newValue = event._original?.scraper?.[field];
            let existingValue = event._original?.calendar?.[field];
            let finalValue = event[field];
            
            // Fix: Use _fieldPriorities instead of _fieldMergeStrategies
            const strategy = event._fieldPriorities?.[field]?.merge || event._fieldMergeStrategies?.[field] || 'preserve';
            
            // Determine what was used by comparing final value with source values
            let wasUsed = 'unknown';
            if (finalValue === newValue && finalValue !== existingValue) {
                wasUsed = 'new';
            } else if (finalValue === existingValue && finalValue !== newValue) {
                wasUsed = 'existing';
            } else if (finalValue === existingValue && finalValue === newValue) {
                wasUsed = 'same';
            }
            
            // For preserve fields, we want to show BOTH the scraped value AND the existing value
            // This matches the old behavior: "show both and then say 'choosing original because preserve'"
            
            // Skip if both are empty and no final value, unless it's a field with explicit strategy
            // For preserve/clobber fields, always show them to demonstrate the strategy in action
            if (!newValue && !existingValue && !finalValue && !strategy) return;
            
            // For preserve fields, always show them if they have a strategy configured
            // This ensures we show "scraped X, existing undefined, choosing undefined because preserve"
            // Don't skip preserve fields even if they appear empty - user needs to see what was preserved
            if (strategy === 'preserve') {
                // Always show preserve fields to demonstrate the strategy, even if all values are empty
                // This is important for showing "scraped value X, existing undefined, preserved undefined"
            }
            
            // Format values for display - show exactly what the merge logic saw
            const formatValue = (val, maxLength = 30) => {
                if (val === null) return '<em style="color: #999;">null</em>';
                if (val === undefined) return '<em style="color: #999;">undefined</em>';
                if (val === '') return '<em style="color: #999;">empty string</em>';
                if (!val) return '<em style="color: #999;">falsy</em>';
                
                if (field.includes('Date') && val) {
                    // For date fields in event debugging, get timezone from city configuration
                    if (field === 'startDate' || field === 'endDate') {
                        const timezone = this.getTimezoneForCity(event?.city);
                        var eventForField = { timeZone: timezone };
                    } else {
                        var eventForField = {};
                    }
                    return new Date(val).toLocaleString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        ...eventForField
                    });
                }
                const str = val.toString();
                if (str.length > maxLength) {
                    return `<span title="${this.escapeHtml(str)}">${this.escapeHtml(str.substring(0, maxLength))}...</span>`;
                }
                return this.escapeHtml(str);
            };
            
            // Determine flow direction and result
            let flowIcon = '';
            let resultText = '';
            
            if (!existingValue && newValue) {
                // New field being added
                flowIcon = '→';
                resultText = '<span style="color: #34c759;">ADDED</span>';
            } else if (existingValue && newValue && existingValue === newValue) {
                // Both values are identical - no change needed
                flowIcon = '—';
                resultText = '<span style="color: #999;">SAME VALUE</span>';
            } else if (strategy === 'clobber') {
                // Clobber strategy - should always use new value (even if empty)
                // For clobber, we should trust that the merge logic worked correctly
                // The finalValue should match newValue, but there might be edge cases with processing
                if (newValue !== undefined && finalValue === newValue) {
                    flowIcon = '→';
                    resultText = '<span style="color: #ff9500;">CLOBBERED</span>';
                } else if (!newValue && !finalValue) {
                    // Clobber with empty new value - clears the field
                    flowIcon = '→';
                    resultText = '<span style="color: #ff9500;">CLEARED</span>';
                } else if (newValue !== undefined) {
                    // For clobber, if we have a new value, assume it worked
                    // The display might show differences due to processing, but trust the merge logic
                    flowIcon = '→';
                    resultText = '<span style="color: #ff9500;">CLOBBERED</span>';
                } else {
                    // Only show failure if we truly can't determine what happened
                    flowIcon = '⚠️';
                    resultText = '<span style="color: #ff3b30;">CLOBBER UNCLEAR</span>';
                }
            } else if (strategy === 'preserve') {
                // Preserve strategy - ALWAYS keep existing value (even if null/empty)
                // For preserve, if existing is undefined, final should also be undefined
                const preserveWorked = (existingValue === undefined && finalValue === undefined) || 
                                     (existingValue !== undefined && finalValue === existingValue);
                
                if (preserveWorked) {
                    flowIcon = '←';
                    if (existingValue !== undefined) {
                        resultText = '<span style="color: #007aff;">PRESERVED EXISTING</span>';
                    } else {
                        resultText = '<span style="color: #007aff;">PRESERVED UNDEFINED (ignored scraped)</span>';
                    }
                } else {
                    // Preserve didn't work as expected - should always keep existing
                    flowIcon = '⚠️';
                    resultText = `<span style="color: #ff3b30;">PRESERVE FAILED (expected: ${existingValue === undefined ? 'undefined' : existingValue}, got: ${finalValue === undefined ? 'undefined' : finalValue})</span>`;
                }
            } else if (wasUsed === 'existing') {
                // Merge strategy explicitly chose existing value
                flowIcon = '←';
                resultText = '<span style="color: #007aff;">EXISTING</span>';
            } else if (finalValue === newValue) {
                // Replaced with new value
                flowIcon = '→';
                resultText = '<span style="color: #ff9500;">NEW</span>';
            } else if (finalValue === existingValue && existingValue !== newValue) {
                // Preserved existing value when values differ
                flowIcon = '←';
                resultText = '<span style="color: #007aff;">EXISTING</span>';
            } else if (finalValue && finalValue !== existingValue && finalValue !== newValue) {
                // Merged/combined value
                flowIcon = '↔';
                resultText = '<span style="color: #32d74b;">MERGED</span>';
            } else {
                flowIcon = '—';
                resultText = '<span style="color: #999;">NO CHANGE</span>';
            }
            
            rows.push(`
                <tr>
                    <td style="padding: 5px; border-bottom: 1px solid var(--border-color); vertical-align: top; word-wrap: break-word; overflow-wrap: break-word; color: var(--text-primary);">
                        <strong>${field}</strong>
                        <br><small style="color: var(--text-secondary);">${strategy}</small>
                    </td>
                    <td style="padding: 5px; border-bottom: 1px solid var(--border-color); word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; color: var(--text-primary);">
                        ${formatValue(existingValue)}
                    </td>
                    <td style="padding: 5px; border-bottom: 1px solid var(--border-color); text-align: center; font-size: 16px; color: var(--primary-color); word-wrap: break-word; overflow-wrap: break-word;">
                        ${flowIcon}
                    </td>
                    <td style="padding: 5px; border-bottom: 1px solid var(--border-color); word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; color: var(--text-primary);">
                        ${formatValue(newValue)}
                    </td>
                    <td style="padding: 5px; border-bottom: 1px solid var(--border-color); text-align: center; word-wrap: break-word; overflow-wrap: break-word; color: var(--text-primary);">
                        ${resultText}
                    </td>
                </tr>
            `);
        });
        
        return rows.join('');
    }
    
    // Generate line-by-line diff view
    generateLineDiffView(event) {
        if (!event._original) return '<p>No comparison data available</p>';
        
        // Use the same field logic as what goes into calendar notes
        const fieldsToCompare = this.getFieldsForComparison(event);
        let html = '<div style="font-family: \'SF Mono\', Monaco, \'Courier New\', monospace; font-size: 12px; background: var(--background-primary); padding: 12px; border-radius: 8px; line-height: 1.6; color: var(--text-primary);">';
        
        fieldsToCompare.forEach((field, index) => {
            // Skip notes field as it's a computed field that combines other fields
            // This makes the comparison confusing and it's often broken
            if (field === 'notes') return;
            
            let newValue = event._original.scraper[field] || '';
            let existingValue = event._original.calendar?.[field] || '';
            let finalValue = event[field] || '';
            // Fix: Use _fieldPriorities instead of _fieldMergeStrategies
            const strategy = event._fieldPriorities?.[field]?.merge || event._fieldMergeStrategies?.[field] || 'preserve';
            
            // Skip if both are empty and no final value
            if (!newValue && !existingValue && !finalValue) return;
            
            // Format dates
            const formatValue = (val) => {
                if (!val) return '';
                if (field.includes('Date') && val) {
                    // Get timezone from city configuration instead of expecting it on the event
                    const timezone = this.getTimezoneForCity(event.city);
                    return new Date(val).toLocaleString('en-US', { timeZone: timezone });
                }
                return val.toString();
            };
            
            // Determine what happened with this field by comparing values
            let wasUsed = 'unknown';
            if (finalValue === newValue && finalValue !== existingValue) {
                wasUsed = 'new';
            } else if (finalValue === existingValue && finalValue !== newValue) {
                wasUsed = 'existing';
            } else if (finalValue === existingValue && finalValue === newValue) {
                wasUsed = 'same';
            }
            const isNew = !existingValue && newValue;
            const isUnchanged = existingValue && !newValue;
            
            const isDateField = field.toLowerCase().includes('date');
            const equalForDisplay = isDateField ? this.datesEqualForDisplay(existingValue, newValue) : (existingValue === newValue);
            const isSame = existingValue && newValue && equalForDisplay;
            
            const isReplaced = existingValue && newValue && (finalValue === newValue) && !equalForDisplay;
            const isKept = existingValue && newValue && (finalValue === existingValue) && !equalForDisplay;
            const isMerged = existingValue && newValue && finalValue && (finalValue !== existingValue) && (finalValue !== newValue) && !equalForDisplay;
            
            // Add field separator for readability (except for first field)
            if (index > 0) {
                html += `<div class=\"diff-sep\"></div>`;
            }
            
            // Add field header
            html += `<div class=\"diff-header\">
                        ${field}
                     </div>`;
            
            // Show git-style diff
            if (isNew) {
                // Only new value exists - show as addition
                html += `<div class=\"diff-line diff-added\">`;
                html += `<span>+</span> ${this.escapeHtml(formatValue(newValue))} <em class=\"diff-meta\">(new field)</em>`;
                html += `</div>`;
            } else if (isUnchanged) {
                // Only existing value exists - show as context (orange)
                html += `<div class=\"diff-line diff-context\">`;
                html += `<span>═</span> ${this.escapeHtml(formatValue(existingValue))} <em class=\"diff-meta\">(existing, unchanged)</em>`;
                html += `</div>`;
            } else if (isSame) {
                // Existing and new are the same for display - avoid +/- noise
                html += `<div class=\"diff-line diff-same\">`;
                html += `<span>═</span> ${this.escapeHtml(formatValue(existingValue))} <em class=\"diff-meta\">(same in both)</em>`;
                html += `</div>`;
            } else if (isReplaced) {
                // Value was replaced - show old as deletion, new as addition
                html += `<div class=\"diff-line diff-removed\">`;
                html += `<span>-</span> ${this.escapeHtml(formatValue(existingValue))} <em class=\"diff-meta\">(removed)</em>`;
                html += `</div>`;
                html += `<div class=\"diff-line diff-added\">`;
                html += `<span>+</span> ${this.escapeHtml(formatValue(newValue))} <em class=\"diff-meta\">(added)</em>`;
                html += `</div>`;
            } else if (isKept) {
                // New value exists but existing was kept - show both with context
                html += `<div class=\"diff-line diff-same\">`;
                html += `<span>═</span> ${this.escapeHtml(formatValue(existingValue))} <em class=\"diff-meta\">(kept existing)</em>`;
                html += `</div>`;
                html += `<div class=\"diff-line diff-ignored\" style=\"opacity:0.85;\">`;
                html += `<span>~</span> ${this.escapeHtml(formatValue(newValue))} <em class=\"diff-meta\">(ignored new value)</em>`;
                html += `</div>`;
            } else if (isMerged) {
                // Values were merged - show all three
                html += `<div class=\"diff-line diff-removed\">`;
                html += `<span>-</span> ${this.escapeHtml(formatValue(existingValue))} <em class=\"diff-meta\">(original)</em>`;
                html += `</div>`;
                html += `<div class=\"diff-line diff-ignored\">`;
                html += `<span>~</span> ${this.escapeHtml(formatValue(newValue))} <em class=\"diff-meta\">(proposed)</em>`;
                html += `</div>`;
                html += `<div class=\"diff-line diff-merged\">`;
                html += `<span>+</span> ${this.escapeHtml(formatValue(finalValue))} <em class=\"diff-meta\">(merged result)</em>`;
                html += `</div>`;
            }
            
            // Add spacing after each field (except last one)
            if (index < fieldsToCompare.length - 1) {
                html += `<div style="margin-bottom: 12px;"></div>`;
            }
        });
        
        html += '</div>';
        return html;
    }

    // Compare two date inputs for display equality, avoiding timezone-related false diffs
    datesEqualForDisplay(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        const da = new Date(a);
        const db = new Date(b);
        if (isNaN(da.getTime()) || isNaN(db.getTime())) {
            return String(a) === String(b);
        }
        if (da.getTime() === db.getTime()) return true;
        try {
            return da.toLocaleString() === db.toLocaleString();
        } catch (e) {
            return da.toString() === db.toString();
        }
    }

    // Prompt user for calendar execution after displaying results
    async promptForCalendarExecution(analyzedEvents, config) {
        if (!analyzedEvents || analyzedEvents.length === 0) {
            return false;
        }
        
        const alert = new Alert();
        alert.title = "Execute Calendar Actions?";
        
        // Count actions by type
        const actionCounts = {};
        analyzedEvents.forEach(event => {
            const action = event._action || 'unknown';
            actionCounts[action] = (actionCounts[action] || 0) + 1;
        });
        
        let message = "Ready to execute the following calendar actions:\n\n";
        if (actionCounts.new) message += `➕ Create ${actionCounts.new} new events\n`;
        if (actionCounts.merge) message += `🔄 Merge ${actionCounts.merge} events\n`;
        if (actionCounts.conflict) message += `⚠️ Skip ${actionCounts.conflict} conflicted events\n`;
        if (actionCounts.missing_calendar) message += `❌ Skip ${actionCounts.missing_calendar} events (missing calendars)\n`;
        
        alert.message = message;
        alert.addAction("Execute");
        alert.addCancelAction("Cancel");
        
        const response = await alert.presentAlert();
        
        if (response === 0) {
            // Before executing writes, attempt to persist capability by writing a temp file. If this fails, abort.
            await this.ensureRelativeStorageDirs();
            const testFilePath = this.fm.joinPath(this.runsDir, '.write-test.json');
            try {
                // Write test file directly using our FileManager
                this.fm.writeString(testFilePath, JSON.stringify({ ts: new Date().toISOString() }));
                // remove temp file
                const fm = this.fm || FileManager.iCloud();
                if (fm.fileExists(testFilePath)) fm.remove(testFilePath);
            } catch (e) {
                const errorAlert = new Alert();
                errorAlert.title = "Cannot Proceed";
                errorAlert.message = "Failed to write to runs directory. Calendar changes will not be executed.";
                errorAlert.addAction("OK");
                await errorAlert.presentAlert();
                return 0;
            }

            // User selected Execute and write preflight works — proceed to execute
            const processedCount = await this.executeCalendarActions(analyzedEvents, config);

            const successAlert = new Alert();
            successAlert.title = "Calendar Updated";
            successAlert.message = `Successfully processed ${processedCount} events.`;
            successAlert.addAction("OK");
            await successAlert.presentAlert();
            
            return processedCount;
        }
        
        return 0;
    }

    // (Directory creation handled by ensureRelativeStorageDirs using embedded JSONFileManager path base)

    async ensureRelativeStorageDirs() {
        try {
            const fm = this.fm || FileManager.iCloud();
            
            console.log(`📱 Scriptable: Ensuring directories in: ${this.baseDir}`);
            if (!fm.fileExists(this.baseDir)) fm.createDirectory(this.baseDir, true);
            if (!fm.fileExists(this.runsDir)) fm.createDirectory(this.runsDir, true);
            if (!fm.fileExists(this.logsDir)) fm.createDirectory(this.logsDir, true);
            if (!fm.fileExists(this.metricsDir)) fm.createDirectory(this.metricsDir, true);
        } catch (e) {
            console.log(`📱 Scriptable: Failed to ensure relative storage dirs: ${e.message}`);
        }
    }

    getRunId(timestamp = new Date()) {
        // Use a filesystem-friendly timestamp
        const pad = n => String(n).padStart(2, '0');
        const y = timestamp.getFullYear();
        const m = pad(timestamp.getMonth() + 1);
        const d = pad(timestamp.getDate());
        const hh = pad(timestamp.getHours());
        const mm = pad(timestamp.getMinutes());
        const ss = pad(timestamp.getSeconds());
        return `${y}${m}${d}-${hh}${mm}${ss}`;
    }

    getRunFilePath(runId) {
        return this.fm.joinPath(this.runsDir, `${runId}.json`);
    }

    async saveRun(results) {
        if (!this.fm) return;
        try {
            // Ensure directories exist first
            await this.ensureRelativeStorageDirs();
            
            const ts = new Date();
            const runId = this.getRunId(ts);
            const runFilePath = this.getRunFilePath(runId);
            const runContext = results.runContext || null;
            const analyzedEvents = this.sanitizeEventsForRunSave(results.analyzedEvents || []);
            
            const summary = {
                runId,
                timestamp: ts.toISOString(),
                runContext,
                totals: {
                    totalEvents: results.totalEvents || 0,
                    bearEvents: results.bearEvents || 0,
                    calendarEvents: results.calendarEvents || 0,
                    errors: (results.errors || []).length
                },
                parserSummaries: (results.parserResults || []).map(r => ({ name: r.name, bearEvents: r.bearEvents, totalEvents: r.totalEvents }))
            };
            
            const payload = {
                version: 2,
                summary,
                runContext,
                config: results.config || null,
                analyzedEvents,
                parserResults: results.parserResults || [],
                errors: results.errors || []
            };

            // Ensure directory exists before writing (same pattern as FileLogger)
            if (!this.fm.fileExists(this.runsDir)) {
                try {
                    this.fm.createDirectory(this.runsDir, true);
                    console.log(`📱 Scriptable: Created runs directory: ${this.runsDir}`);
                } catch (dirErr) {
                    console.log(`📱 Scriptable: Directory creation failed: ${dirErr.message}`);
                    throw dirErr;
                }
            }
            
            // Check if path is a directory
            if (this.fm.fileExists(runFilePath) && this.fm.isDirectory(runFilePath)) {
                throw new Error("Run file path is a directory, please delete!");
            }
            
            // Save run using absolute path
            this.fm.writeString(runFilePath, JSON.stringify(payload));
            console.log(`📱 Scriptable: ✓ Saved run ${runId} to ${runFilePath}`);
            return runId;
        } catch (e) {
            console.log(`📱 Scriptable: ✗ Failed to save run: ${e.message}`);
        }
    }

    listSavedRuns() {
        // Read directory contents directly - no index needed
        try {
            const fm = this.fm || FileManager.iCloud();
            const runsPath = this.runsDir;
            
            console.log(`📱 Scriptable: Looking for runs in: ${runsPath}`);
            if (!fm.fileExists(runsPath)) {
                console.log(`📱 Scriptable: Runs directory does not exist: ${runsPath}`);
                return [];
            }
            
            // Ensure iCloud files are downloaded before listing
            try {
                fm.downloadFileFromiCloud(runsPath);
            } catch (downloadError) {
                console.log(`📱 Scriptable: Note - iCloud download attempt: ${downloadError.message}`);
            }
            
            const files = fm.listContents(runsPath) || [];
            console.log(`📱 Scriptable: Found ${files.length} files: ${JSON.stringify(files)}`);
            
            // Filter out directories and only keep JSON files
            const jsonFiles = files.filter(name => {
                const filePath = fm.joinPath(runsPath, name);
                try {
                    // Ensure each file is downloaded from iCloud
                    fm.downloadFileFromiCloud(filePath);
                    return name.endsWith('.json') && !fm.isDirectory(filePath);
                } catch (error) {
                    console.log(`📱 Scriptable: Error checking file ${name}: ${error.message}`);
                    return false;
                }
            });
            
            console.log(`📱 Scriptable: Filtered to ${jsonFiles.length} JSON files: ${JSON.stringify(jsonFiles)}`);
            
            return jsonFiles
                .map(name => ({ runId: name.replace('.json',''), timestamp: null }))
                .sort((a, b) => (b.runId || '').localeCompare(a.runId || ''));
        } catch (e) {
            console.log(`📱 Scriptable: Failed to read runs directory: ${e.message}`);
            return [];
        }
    }

    loadSavedRun(runId) {
        try {
            const fm = this.fm || FileManager.iCloud();
            const runFilePath = this.getRunFilePath(runId);
            
            console.log(`📱 Scriptable: Loading run from: ${runFilePath}`);
            if (!fm.fileExists(runFilePath)) {
                console.log(`📱 Scriptable: Run file does not exist: ${runFilePath}`);
                return null;
            }
            
            // Ensure file is downloaded from iCloud before reading
            try {
                fm.downloadFileFromiCloud(runFilePath);
            } catch (downloadError) {
                console.log(`📱 Scriptable: Note - iCloud download attempt: ${downloadError.message}`);
            }
            
            const content = fm.readString(runFilePath);
            console.log(`📱 Scriptable: Raw content type: ${typeof content}, content: ${content === null ? 'null' : content === undefined ? 'undefined' : 'valid'}`);
            
            if (content === null || content === undefined) {
                console.log(`📱 Scriptable: File content is null or undefined`);
                return null;
            }
            
            if (content.trim().length === 0) {
                console.log(`📱 Scriptable: File content is empty`);
                return null;
            }
            
            console.log(`📱 Scriptable: Successfully read file, content length: ${content.length}`);
            return JSON.parse(content);
        } catch (e) {
            console.log(`📱 Scriptable: Failed to load run ${runId}: ${e.message}`);
            return null;
        }
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
            const savedRunContext = saved?.runContext || saved?.summary?.runContext || null;
            const resultsLike = {
                totalEvents: saved?.summary?.totals?.totalEvents || 0,
                bearEvents: saved?.summary?.totals?.bearEvents || 0,
                calendarEvents: 0, // Always 0 for saved runs to prevent re-saving
                errors: saved?.errors || [],
                parserResults: saved?.parserResults || [],
                analyzedEvents: Array.isArray(saved?.analyzedEvents) ? saved.analyzedEvents : [],
                config: saved?.config || null,
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

            await this.displayResults(resultsLike);
        } catch (e) {
            console.log(`📱 Scriptable: Failed to display saved run: ${e.message}`);
        }
    }

    async cleanupOldFiles(relDirPath, { maxAgeDays = 30, keep = () => false, afterCleanup = null } = {}) {
        // Use documents directory as base, not script directory
        const documentsDir = this.fm.documentsDirectory();
        const dirPath = this.fm.joinPath(documentsDir, relDirPath);
        const fm = this.fm || FileManager.iCloud();
        if (!fm.fileExists(dirPath)) return;
        const now = Date.now();
        const cutoff = now - (maxAgeDays * 24 * 60 * 60 * 1000);
        const files = fm.listContents(dirPath) || [];
        files.forEach(name => {
            if (keep(name)) return;
            const path = fm.joinPath(dirPath, name);
            let mtime = null;
            try { mtime = fm.modificationDate(path); } catch (_) {}
            const ms = mtime ? mtime.getTime() : null;
            if (ms && ms < cutoff) {
                try { fm.remove(path); } catch (_) {}
            }
        });
        if (typeof afterCleanup === 'function') {
            await afterCleanup();
        }
    }

    // Metrics helpers
    getMetricsFilePath() {
        return this.fm.joinPath(this.metricsDir, 'metrics.ndjson');
    }

    getMetricsSummaryPath() {
        return this.fm.joinPath(this.metricsDir, 'metrics-summary.json');
    }

    createMetricsActionCounts() {
        return {
            new: 0,
            merge: 0,
            conflict: 0,
            missing_calendar: 0,
            other: 0
        };
    }

    countMetricsActions(events) {
        const counts = this.createMetricsActionCounts();
        if (!Array.isArray(events)) return counts;
        events.forEach(event => {
            const action = (event?._action || '').toLowerCase();
            if (!action) return;
            if (Object.prototype.hasOwnProperty.call(counts, action)) {
                counts[action] += 1;
            } else {
                counts.other += 1;
            }
        });
        return counts;
    }

    countMetricsActionsByParser(events) {
        const countsByParser = {};
        if (!Array.isArray(events)) return countsByParser;
        events.forEach(event => {
            const parserName = event?._parserConfig?.name || null;
            if (!parserName) return;
            if (!countsByParser[parserName]) {
                countsByParser[parserName] = this.createMetricsActionCounts();
            }
            const action = (event?._action || '').toLowerCase();
            if (!action) return;
            if (Object.prototype.hasOwnProperty.call(countsByParser[parserName], action)) {
                countsByParser[parserName][action] += 1;
            } else {
                countsByParser[parserName].other += 1;
            }
        });
        return countsByParser;
    }

    getMetricsStatus(results, errorsCount, warningsCount) {
        const errorTotal = Number.isFinite(errorsCount) ? errorsCount : 0;
        const warningTotal = Number.isFinite(warningsCount) ? warningsCount : 0;
        if (errorTotal > 0) {
            return 'failed';
        }
        if (warningTotal > 0) {
            return 'partial';
        }
        return 'success';
    }

    buildMetricsRecord(results) {
        const runId = results?.savedRunId || results?.sourceRunId || results?.runId || results?.summary?.runId || null;
        if (!runId) {
            return null;
        }

        const finishedAt = new Date();
        const startedAt = this.runStartedAt instanceof Date ? this.runStartedAt : null;
        const durationMs = startedAt ? finishedAt.getTime() - startedAt.getTime() : null;
        const errorsCount = (results?.errors || []).length;
        const warningsCount = this.warnCount || 0;
        const analyzedEvents = Array.isArray(results?.analyzedEvents) ? results.analyzedEvents : [];
        const parserResults = Array.isArray(results?.parserResults) ? results.parserResults : [];
        const runContext = results?.runContext || null;
        const triggerType = (runContext?.type === 'manual' || runContext?.type === 'automated') ? runContext.type : 'unknown';
        const actions = this.countMetricsActions(analyzedEvents);
        const actionsByParser = this.countMetricsActionsByParser(analyzedEvents);

        const mergeDiffFieldsUpdated = analyzedEvents.reduce((sum, event) => {
            const updatedCount = event?._mergeDiff?.updated?.length || 0;
            return sum + updatedCount;
        }, 0);

        const totals = {
            total_events: results?.totalEvents || 0,
            raw_bear_events: results?.rawBearEvents || 0,
            final_bear_events: results?.bearEvents || 0,
            duplicates_removed: results?.duplicatesRemoved || 0,
            deduplicated_events: results?.deduplicatedEvents || 0,
            calendar_events: results?.calendarEvents || 0
        };

        const parsers = parserResults.map(result => {
            const parserName = result?.name || null;
            const parserType = result?.parserType || result?.config?.parser || null;
            const parserActions = parserName && actionsByParser[parserName]
                ? actionsByParser[parserName]
                : this.createMetricsActionCounts();
            return {
                parser_name: parserName,
                parser_type: parserType,
                url_count: Number.isFinite(result?.urlCount) ? result.urlCount : 0,
                total_events: result?.totalEvents || 0,
                raw_bear_events: result?.rawBearEvents || 0,
                final_bear_events: result?.bearEvents || 0,
                duplicates_removed: result?.duplicatesRemoved || 0,
                duration_ms: Number.isFinite(result?.durationMs) ? result.durationMs : null,
                actions: parserActions
            };
        });

        return {
            schema_version: 1,
            run_id: runId,
            started_at: startedAt ? startedAt.toISOString() : null,
            finished_at: finishedAt.toISOString(),
            duration_ms: durationMs,
            trigger_type: triggerType,
            status: this.getMetricsStatus(results, errorsCount, warningsCount),
            environment: runContext?.environment || this.runtimeContext?.environment || 'unknown',
            run_context: runContext,
            config_files: ['scraper-input.js', 'scraper-cities.js'],
            run_file_path: this.getRunFilePath(runId),
            log_file_path: this.getLogFilePath(runId),
            metrics_file_path: this.getMetricsFilePath(),
            summary_file_path: this.getMetricsSummaryPath(),
            errors_count: errorsCount,
            warnings_count: warningsCount,
            totals,
            actions,
            merge_diff_fields_updated: mergeDiffFieldsUpdated,
            parsers
        };
    }

    async appendMetricsRecord(record, retentionDays) {
        const fm = this.fm || FileManager.iCloud();
        const path = this.getMetricsFilePath();
        let existing = '';

        if (fm.fileExists(path)) {
            fm.downloadFileFromiCloud(path);
            existing = fm.readString(path) || '';
        }

        const retentionMs = (retentionDays || 0) * 24 * 60 * 60 * 1000;
        const cutoffMs = retentionMs > 0 ? Date.now() - retentionMs : null;
        const lines = existing.split('\n').filter(line => line.trim().length > 0);
        const keptLines = [];

        lines.forEach(line => {
            const parsed = JSON.parse(line);
            const finishedAtMs = parsed?.finished_at ? new Date(parsed.finished_at).getTime() : null;
            if (!finishedAtMs || !Number.isFinite(finishedAtMs)) return;
            if (!cutoffMs || finishedAtMs >= cutoffMs) {
                keptLines.push(line);
            }
        });

        const line = JSON.stringify(record);
        keptLines.push(line);
        const newContent = `${keptLines.join('\n')}\n`;

        fm.writeString(path, newContent);
        console.log(`📱 Scriptable: ✓ Appended metrics to ${path}`);
    }

    createMetricsSummaryBucket() {
        return {
            runs: 0,
            statuses: { success: 0, partial: 0, failed: 0 },
            errors_count: 0,
            warnings_count: 0,
            duration_ms_total: 0,
            totals: {
                total_events: 0,
                raw_bear_events: 0,
                final_bear_events: 0,
                duplicates_removed: 0,
                deduplicated_events: 0,
                calendar_events: 0
            },
            actions: this.createMetricsActionCounts(),
            merge_diff_fields_updated: 0
        };
    }

    createParserSummaryBucket() {
        return {
            runs: 0,
            duration_ms_total: 0,
            totals: {
                total_events: 0,
                raw_bear_events: 0,
                final_bear_events: 0,
                duplicates_removed: 0
            },
            actions: this.createMetricsActionCounts()
        };
    }

    createParserSummaryGroup() {
        return {
            totals: this.createParserSummaryBucket(),
            by_day: {},
            by_month: {}
        };
    }

    applyMetricsRecordToBucket(bucket, record) {
        bucket.runs += 1;
        if (bucket.statuses && record.status) {
            bucket.statuses[record.status] = (bucket.statuses[record.status] || 0) + 1;
        }
        bucket.errors_count += record.errors_count || 0;
        bucket.warnings_count += record.warnings_count || 0;
        bucket.duration_ms_total += record.duration_ms || 0;

        Object.keys(bucket.totals).forEach(key => {
            bucket.totals[key] += record.totals?.[key] || 0;
        });

        Object.keys(bucket.actions).forEach(key => {
            bucket.actions[key] += record.actions?.[key] || 0;
        });

        bucket.merge_diff_fields_updated += record.merge_diff_fields_updated || 0;
    }

    applyParserRecordToBucket(bucket, parserRecord) {
        bucket.runs += 1;
        bucket.duration_ms_total += parserRecord.duration_ms || 0;

        Object.keys(bucket.totals).forEach(key => {
            bucket.totals[key] += parserRecord?.[key] || 0;
        });

        Object.keys(bucket.actions).forEach(key => {
            bucket.actions[key] += parserRecord.actions?.[key] || 0;
        });
    }

    async updateMetricsSummary(record) {
        const fm = this.fm || FileManager.iCloud();
        const summaryPath = this.getMetricsSummaryPath();
        let summary = null;

        if (fm.fileExists(summaryPath)) {
            fm.downloadFileFromiCloud(summaryPath);
            const summaryText = fm.readString(summaryPath);
            summary = JSON.parse(summaryText);
            if (!summary || typeof summary !== 'object') {
                throw new Error('Metrics summary is invalid');
            }
        } else {
            summary = {
                version: 1,
                updated_at: null,
                totals: this.createMetricsSummaryBucket(),
                by_day: {},
                by_month: {},
                by_parser_name: {},
                by_parser_type: {}
            };
        }

        const dayKey = record.finished_at.slice(0, 10);
        const monthKey = record.finished_at.slice(0, 7);

        summary.updated_at = new Date().toISOString();
        if (!summary.totals) summary.totals = this.createMetricsSummaryBucket();
        this.applyMetricsRecordToBucket(summary.totals, record);

        summary.by_day = summary.by_day || {};
        if (!summary.by_day[dayKey]) summary.by_day[dayKey] = this.createMetricsSummaryBucket();
        this.applyMetricsRecordToBucket(summary.by_day[dayKey], record);

        summary.by_month = summary.by_month || {};
        if (!summary.by_month[monthKey]) summary.by_month[monthKey] = this.createMetricsSummaryBucket();
        this.applyMetricsRecordToBucket(summary.by_month[monthKey], record);

        summary.by_parser_name = summary.by_parser_name || {};
        summary.by_parser_type = summary.by_parser_type || {};

        record.parsers.forEach(parserRecord => {
            if (parserRecord.parser_name) {
                if (!summary.by_parser_name[parserRecord.parser_name]) {
                    summary.by_parser_name[parserRecord.parser_name] = this.createParserSummaryGroup();
                }
                const parserGroup = summary.by_parser_name[parserRecord.parser_name];
                this.applyParserRecordToBucket(parserGroup.totals, parserRecord);
                if (!parserGroup.by_day[dayKey]) parserGroup.by_day[dayKey] = this.createParserSummaryBucket();
                this.applyParserRecordToBucket(parserGroup.by_day[dayKey], parserRecord);
                if (!parserGroup.by_month[monthKey]) parserGroup.by_month[monthKey] = this.createParserSummaryBucket();
                this.applyParserRecordToBucket(parserGroup.by_month[monthKey], parserRecord);
            }

            if (parserRecord.parser_type) {
                if (!summary.by_parser_type[parserRecord.parser_type]) {
                    summary.by_parser_type[parserRecord.parser_type] = this.createParserSummaryGroup();
                }
                const parserTypeGroup = summary.by_parser_type[parserRecord.parser_type];
                this.applyParserRecordToBucket(parserTypeGroup.totals, parserRecord);
                if (!parserTypeGroup.by_day[dayKey]) parserTypeGroup.by_day[dayKey] = this.createParserSummaryBucket();
                this.applyParserRecordToBucket(parserTypeGroup.by_day[dayKey], parserRecord);
                if (!parserTypeGroup.by_month[monthKey]) parserTypeGroup.by_month[monthKey] = this.createParserSummaryBucket();
                this.applyParserRecordToBucket(parserTypeGroup.by_month[monthKey], parserRecord);
            }
        });

        fm.writeString(summaryPath, JSON.stringify(summary));
        console.log(`📱 Scriptable: ✓ Updated metrics summary at ${summaryPath}`);
    }

    // Log helpers (prefer user's file logger)
    resolveLogConfig(config) {
        const configRoot = config?.config || {};
        const logging = config?.logging || configRoot.logging || {};
        const mode = String(logging.mode || configRoot.logMode || 'tail').toLowerCase();
        const maxLines = Number.isFinite(logging.maxLines)
            ? logging.maxLines
            : Number.isFinite(configRoot.logMaxLines)
                ? configRoot.logMaxLines
                : 2000;
        const maxBytes = Number.isFinite(logging.maxBytes)
            ? logging.maxBytes
            : Number.isFinite(configRoot.logMaxBytes)
                ? configRoot.logMaxBytes
                : 250000;
        return { mode, maxLines, maxBytes };
    }
    
    applyLogConfig(config) {
        const logConfig = this.resolveLogConfig(config);
        let captureMode = 'all';
        if (['summary', 'off', 'none'].includes(logConfig.mode)) {
            captureMode = 'none';
        } else if (['errors', 'error'].includes(logConfig.mode)) {
            captureMode = 'errors';
        }
        logger.configure({
            maxLines: logConfig.maxLines,
            maxBytes: logConfig.maxBytes,
            captureMode
        });
    }
    
    resolveLogOutputMode(logConfig, results) {
        const mode = String(logConfig.mode || 'tail').toLowerCase();
        if (['summary', 'off', 'none'].includes(mode)) {
            return 'summary';
        }
        if (['errors', 'error', 'errors-only'].includes(mode)) {
            return 'errors';
        }
        if (['failures', 'failure', 'failures-only', 'failure-only'].includes(mode)) {
            const hasErrors = (results?.errors || []).length > 0;
            return hasErrors ? 'full' : 'summary';
        }
        return 'full';
    }
    
    getRunIdForLogs(results) {
        return results?.sourceRunId
            || results?.savedRunId
            || results?.runId
            || results?.summary?.runId
            || null;
    }

    async loadRunLogsForDisplay(results) {
        const runId = this.getRunIdForLogs(results);
        if (!runId) {
            return { runId: null, exists: false, reason: 'missing-run-id' };
        }
        const logPath = this.getLogFilePath(runId);
        if (!logPath) {
            return { runId, exists: false, reason: 'missing-log-path' };
        }
        const fm = this.fm || FileManager.iCloud();
        if (!fm.fileExists(logPath)) {
            return { runId, exists: false, reason: 'missing-log-file' };
        }

        try {
            try {
                await fm.downloadFileFromiCloud(logPath);
            } catch (downloadError) {
                console.log(`📱 Scriptable: Log iCloud download failed: ${downloadError.message}`);
            }
            const content = fm.readString(logPath);
            if (!content || !content.trim()) {
                return { runId, exists: false, reason: 'empty-log-file' };
            }
            let lines = content.split(/\r?\n/);
            if (lines.length > 0 && lines[lines.length - 1] === '') {
                lines = lines.slice(0, -1);
            }
            const totalLines = lines.length;
            const maxLines = 2000;
            let displayLines = lines;
            let truncated = false;
            if (lines.length > maxLines) {
                displayLines = lines.slice(lines.length - maxLines);
                truncated = true;
            }
            const text = displayLines.join('\n');
            return {
                runId,
                exists: true,
                text,
                totalLines,
                shownLines: displayLines.length,
                truncated
            };
        } catch (e) {
            console.log(`📱 Scriptable: Failed to read log file: ${e.message}`);
            return { runId, exists: false, reason: 'read-failed' };
        }
    }

    getLogFilePath(runId) {
        if (!runId) {
            return null;
        }
        return this.fm.joinPath(this.logsDir, `${runId}.log`);
    }

    async appendLogSummary(results) {
        try {
            const runId = results?.savedRunId || results?.sourceRunId || results?.runId || results?.summary?.runId || null;
            const runContext = results?.runContext || null;
            const logPath = this.getLogFilePath(runId);
            if (!logPath) {
                console.log('📱 Scriptable: Skipping log write (missing runId)');
                return;
            }
            const summary = {
                timestamp: new Date().toISOString(),
                runId,
                runContext,
                totals: {
                    totalEvents: results.totalEvents || 0,
                    bearEvents: results.bearEvents || 0,
                    calendarEvents: results.calendarEvents || 0,
                    errors: (results.errors || []).length
                }
            };
            const summaryLine = `${new Date().toISOString()} - ${JSON.stringify(summary)}`;
            const logConfig = this.resolveLogConfig(results?.config || {});
            const outputMode = this.resolveLogOutputMode(logConfig, results);
            const logText = logger.getLogText({
                mode: outputMode,
                maxLines: logConfig.maxLines,
                maxBytes: logConfig.maxBytes
            });
            const content = logText ? `${summaryLine}\n${logText}` : `${summaryLine}\n`;
            
            const fm = this.fm || FileManager.iCloud();
            if (!fm.fileExists(this.logsDir)) {
                fm.createDirectory(this.logsDir, true);
            }
            
            fm.writeString(logPath, content);
            console.log(`📱 Scriptable: Successfully wrote log to ${logPath}`);
        } catch (e) {
            console.log(`📱 Scriptable: Failed to append log: ${e.message}`);
        }
    }

}

// Export for Scriptable environment
module.exports = { ScriptableAdapter };

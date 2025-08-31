// Centralized Logging System for chunky.dad
// Provides consistent, useful debugging information for users and developers

// Path utility for resolving asset paths based on current page location
class PathUtils {
    constructor() {
        this.isSubdirectory = this.detectSubdirectory();
        this.pathPrefix = this.isSubdirectory ? '../' : '';
    }
    
    // Detect if we're in a city subdirectory
    detectSubdirectory() {
        const pathname = window.location.pathname;
        // Check if we're in a city directory (not root, not testing, not tools)
        const pathSegments = pathname.split('/').filter(Boolean);
        
        // If we have path segments and the first one isn't a known root file
        if (pathSegments.length > 0) {
            const firstSegment = pathSegments[0].toLowerCase();
            // Skip known root files and testing directories
            const rootFiles = ['index.html', 'city.html', 'bear-directory.html', 'test', 'testing', 'tools', 'scripts'];
            const isRootFile = rootFiles.some(file => firstSegment.includes(file));
            
            // If not a root file and we have segments, we're likely in a subdirectory
            if (!isRootFile && pathSegments.length >= 1) {
                return true;
            }
        }
        
        return false;
    }
    
    // Resolve asset path based on current location
    resolvePath(assetPath) {
        // Don't modify absolute URLs or data URLs
        if (assetPath.startsWith('http') || assetPath.startsWith('//') || assetPath.startsWith('data:')) {
            return assetPath;
        }
        
        // Don't modify paths that already have ../ prefix
        if (assetPath.startsWith('../')) {
            return assetPath;
        }
        
        return this.pathPrefix + assetPath;
    }
    
    // Convenience method for the common logo image
    getLogoPath() {
        return this.resolvePath('Rising_Star_Ryan_Head_Compressed.png');
    }
}

class ChunkyLogger {
    constructor() {
        this.debugMode = true; // Set to false in production
        this.logLevel = 'DEBUG'; // DEBUG, INFO, WARN, ERROR
        this.componentColors = {
            'PAGE': '#2E7D32',      // Green
            'CALENDAR': '#1976D2',   // Blue  
            'MAP': '#F57C00',        // Orange
            'FORM': '#7B1FA2',       // Purple
            'NAV': '#D32F2F',        // Red
            'CITY': '#00796B',       // Teal
            'EVENT': '#5D4037',      // Brown
            'SYSTEM': '#424242',     // Grey
            'DIRECTORY': '#E91E63'   // Pink
        };
        
        this.levels = {
            'DEBUG': 0,
            'INFO': 1,
            'WARN': 2,
            'ERROR': 3
        };
        
        this.init();
    }

    init() {
        // Add performance monitoring
        this.startTime = performance.now();
        
        // Log system initialization
        this.info('SYSTEM', 'ChunkyLogger initialized', {
            debugMode: this.debugMode,
            logLevel: this.logLevel,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString()
        });
        
        // Monitor page load performance
        window.addEventListener('load', () => {
            const loadTime = performance.now() - this.startTime;
            this.info('PAGE', 'Page fully loaded', {
                loadTime: `${loadTime.toFixed(2)}ms`,
                readyState: document.readyState
            });
        });
        
        // Add path resolution utility
        this.pathUtils = new PathUtils();
        
        // Monitor DOM ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                const domTime = performance.now() - this.startTime;
                this.info('PAGE', 'DOM ready', {
                    domTime: `${domTime.toFixed(2)}ms`
                });
            });
        }
        
        // Monitor errors
        window.addEventListener('error', (event) => {
            this.error('SYSTEM', 'JavaScript error caught', {
                message: event.error?.message || event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack
            });
        });
        
        // Monitor unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            this.error('SYSTEM', 'Unhandled promise rejection', {
                reason: event.reason,
                promise: event.promise
            });
        });
    }

    shouldLog(level) {
        return this.debugMode && this.levels[level] >= this.levels[this.logLevel];
    }

    formatMessage(level, component, message, data) {
        const timestamp = new Date().toLocaleTimeString();
        const color = this.componentColors[component] || this.componentColors['SYSTEM'];
        
        return {
            timestamp,
            level,
            component,
            message,
            data,
            color,
            fullMessage: `[${timestamp}] ${level} ${component}: ${message}`
        };
    }

    log(level, component, message, data = null) {
        if (!this.shouldLog(level)) return;
        
        const formatted = this.formatMessage(level, component, message, data);
        
        // Console output with styling
        const args = [
            `%c[${formatted.timestamp}] %c${formatted.level} %c${formatted.component}%c: ${formatted.message}`,
            'color: #666;',
            `color: ${this.getLevelColor(level)}; font-weight: bold;`,
            `color: ${formatted.color}; font-weight: bold;`,
            'color: inherit;'
        ];
        
        if (data) {
            args.push(data);
        }
        
        if (level === 'ERROR') {
            console.error(...args);
        } else if (level === 'WARN') {
            console.warn(...args);
        } else {
            console.log(...args);
        }
    }

    getLevelColor(level) {
        const colors = {
            'DEBUG': '#666',
            'INFO': '#2196F3',
            'WARN': '#FF9800',
            'ERROR': '#F44336'
        };
        return colors[level] || '#666';
    }

    // Public logging methods
    debug(component, message, data = null) {
        this.log('DEBUG', component, message, data);
    }

    info(component, message, data = null) {
        this.log('INFO', component, message, data);
    }

    warn(component, message, data = null) {
        this.log('WARN', component, message, data);
    }

    error(component, message, data = null) {
        this.log('ERROR', component, message, data);
    }

    // Specialized logging methods
    pageLoad(component, message, data = null) {
        this.info(component, `✅ ${message}`, data);
    }

    apiCall(component, message, data = null) {
        this.info(component, `🌐 ${message}`, data);
    }

    userInteraction(component, message, data = null) {
        this.debug(component, `👤 ${message}`, data);
    }

    performance(component, message, data = null) {
        this.info(component, `⚡ ${message}`, data);
    }

    // Component-specific helpers
    componentInit(component, message = 'initialized', data = null) {
        this.info(component, `🚀 Component ${message}`, data);
    }

    componentLoad(component, message = 'loaded successfully', data = null) {
        this.pageLoad(component, message, data);
    }

    componentError(component, message, error = null) {
        this.error(component, `❌ ${message}`, error);
    }

    // Timing utilities
    time(component, label) {
        if (this.shouldLog('DEBUG')) {
            console.time(`${component}: ${label}`);
        }
    }

    timeEnd(component, label) {
        if (this.shouldLog('DEBUG')) {
            console.timeEnd(`${component}: ${label}`);
        }
    }

    // Debug mode control
    enableDebug() {
        this.debugMode = true;
        this.info('SYSTEM', 'Debug mode enabled');
    }

    disableDebug() {
        this.debugMode = false;
        console.log('ChunkyLogger: Debug mode disabled');
    }

    setLogLevel(level) {
        if (this.levels[level] !== undefined) {
            this.logLevel = level;
            this.info('SYSTEM', `Log level set to ${level}`);
        }
    }
}

// Create global logger instance
const logger = new ChunkyLogger();
const pathUtils = new PathUtils();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { logger, pathUtils };
} else {
    window.logger = logger;
    window.pathUtils = pathUtils;
}
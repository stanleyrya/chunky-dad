// Centralized Logging System for chunky.dad
// Provides consistent, useful debugging information for users and developers

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
        this.activeTimers = new Set();
        
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
            const isScriptError = event.message === 'Script error.' && !event.filename;
            const isCrossOriginError = !event.filename || event.filename === '';
            
            this.error('SYSTEM', 'JavaScript error caught', {
                message: event.error?.message || event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack,
                isScriptError,
                isCrossOriginError
            });
            
            // Provide specific guidance for script errors
            if (isScriptError || isCrossOriginError) {
                this.warn('SYSTEM', 'Cross-origin script error detected', {
                    explanation: 'This error typically occurs when external scripts fail to load or execute',
                    possibleCauses: [
                        'External service (CORS proxy, CDN) temporarily unavailable',
                        'Network connectivity issues',
                        'Browser security restrictions',
                        'External script contains errors'
                    ],
                    suggestion: 'Check browser network tab for failed requests and try refreshing the page'
                });
            }
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
            const timerLabel = `${component}: ${label}`;
            if (this.activeTimers.has(timerLabel)) {
                console.timeEnd(timerLabel);
                this.activeTimers.delete(timerLabel);
            }
            console.time(timerLabel);
            this.activeTimers.add(timerLabel);
        }
    }

    timeEnd(component, label) {
        const timerLabel = `${component}: ${label}`;
        if (!this.activeTimers.has(timerLabel)) return;
        console.timeEnd(timerLabel);
        this.activeTimers.delete(timerLabel);
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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = logger;
} else {
    window.logger = logger;
}
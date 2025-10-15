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
            
            // First check if it's a known city (most reliable)
            if (window.CITY_CONFIG && window.CITY_CONFIG[firstSegment]) {
                return true;
            }
            
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

// Initialize PathUtils early so it's available to all modules
const pathUtils = new PathUtils();
window.pathUtils = pathUtils;

// Global error handlers
window.addEventListener('unhandledrejection', function(event) {
    // Enhanced logging for promise rejections with better context
    const reason = event.reason;
    const isNetworkError = reason?.name === 'TypeError' && reason?.message?.includes('fetch');
    const isCorsError = reason?.message?.includes('CORS') || reason?.message?.includes('cross-origin');
    const isTimeoutError = reason?.name === 'AbortError' || reason?.message?.includes('timeout');
    
    logger.error('SYSTEM', 'Unhandled promise rejection', {
        reason: reason,
        promise: event.promise,
        message: reason?.message || 'Unknown error',
        stack: reason?.stack || 'No stack trace',
        errorType: reason?.name || 'Unknown',
        isNetworkError,
        isCorsError,
        isTimeoutError,
        url: window.location.href,
        timestamp: new Date().toISOString()
    });
    
    // Log specific guidance for common error types
    if (isNetworkError || isCorsError) {
        logger.warn('SYSTEM', 'Network/CORS error detected - this may be related to external service availability', {
            suggestion: 'Check browser console for more details and verify external services are accessible'
        });
    }
    
    if (isTimeoutError) {
        logger.warn('SYSTEM', 'Timeout error detected - external service may be slow or unavailable', {
            suggestion: 'Try refreshing the page or check network connectivity'
        });
    }
    
    // Don't prevent default - let errors show in console
    // event.preventDefault();
});

// Error handling is managed by logger.js to avoid duplicate handlers

// Main Application Module - Coordinates all other modules and handles initialization
class ChunkyDadApp {
    constructor() {
        this.isMainPage = this.checkIfMainPage();
        this.isCityPage = this.checkIfCityPage();
        this.isTestPage = this.checkIfTestPage();
        this.isDirectoryPage = this.checkIfDirectoryPage();
        
        // Initialize path utilities
        this.pathUtils = window.pathUtils;
        
        // Initialize modules
        this.componentsManager = null;
        this.navigationManager = null;
        this.pageEffectsManager = null;
        this.formsManager = null;
        this.calendarLoader = null;
        this.bearDirectory = null;
        this.debugOverlay = null;
        this.cityRenderer = null;
        this.bearEventRenderer = null;
        this.dadJokesManager = null;
        this.todayEventsAggregator = null;
        
        logger.componentInit('SYSTEM', 'chunky.dad App initializing', {
            isMainPage: this.isMainPage,
            isCityPage: this.isCityPage,
            isTestPage: this.isTestPage,
            isDirectoryPage: this.isDirectoryPage,
            pathname: window.location.pathname
        });
        
        this.init();
    }

    checkIfMainPage() {
        return window.location.pathname.endsWith('index.html') || 
               window.location.pathname === '/' || 
               window.location.pathname === '';
    }

    checkIfCityPage() {
        try {
            // City page if using legacy template OR if first path segment matches a city slug/alias
            if (window.location.pathname.includes('city.html')) return true;
            
            // Check if we're in a city subdirectory
            const slug = this.getCitySlugFromPath();
            if (slug) {
                logger.debug('SYSTEM', 'Detected city page via slug', { slug, pathname: window.location.pathname });
                return true;
            }
            
            return false;
        } catch (e) {
            logger.warn('SYSTEM', 'City page detection failed, defaulting to non-city page', { error: e?.message });
            return false;
        }
    }

    checkIfTestPage() {
        return window.location.pathname.includes('test-calendar-logging.html');
    }

    // Detect a city slug from the first path segment (supports aliases if defined in CITY_CONFIG)
    getCitySlugFromPath() {
        try {
            const path = window.location.pathname || '/';
            const parts = path.split('/').filter(Boolean);
            // Handle project pages on GitHub Pages where repo name is first segment
            // Try to find a segment that matches a city slug by scanning from the end backwards
            const candidates = parts.length > 0 ? parts.slice(0) : [];
            if (candidates.length === 0) return null;
            // Prefer the first segment after potential repo segment; check both first and second
            const possibleSlugs = [];
            if (candidates.length >= 1) possibleSlugs.push(candidates[0].toLowerCase());
            if (candidates.length >= 2 && candidates[1].toLowerCase() !== 'index.html') {
                possibleSlugs.push(candidates[1].toLowerCase());
            }
            const cityConfig = (typeof window !== 'undefined' && window.CITY_CONFIG) ? window.CITY_CONFIG : {};
            for (const slug of possibleSlugs) {
                if (cityConfig && cityConfig[slug]) return slug;
                // Check aliases if present
                for (const [key, cfg] of Object.entries(cityConfig || {})) {
                    if (cfg && Array.isArray(cfg.aliases)) {
                        if (cfg.aliases.map(a => String(a).toLowerCase()).includes(slug)) return key;
                    }
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    checkIfDirectoryPage() {
        return window.location.pathname.includes('bear-directory.html');
    }

    async init() {
        try {
            // Always initialize core modules
            this.initializeCoreModules();
            
            // Initialize page-specific modules (don't let them block each other)
            if (this.isCityPage || this.isTestPage || this.isMainPage) {
                // Initialize city page modules asynchronously to prevent blocking
                this.initializeCityPageModules().catch(error => {
                    logger.componentError('SYSTEM', 'City page module initialization failed', error);
                    // Ensure error is not re-thrown to prevent unhandled promise rejection
                    return null;
                });
            }
            
            if (this.isDirectoryPage) {
                // Don't await directory page modules to prevent hanging
                this.initializeDirectoryPageModules().catch(error => {
                    logger.componentError('SYSTEM', 'Directory page module initialization failed', error);
                    // Ensure error is not re-thrown to prevent unhandled promise rejection
                    return null;
                });
            }
            
            logger.componentLoad('SYSTEM', 'chunky.dad App initialization complete');
        } catch (error) {
            logger.componentError('SYSTEM', 'App initialization failed', error);
        }
    }

    initializeCoreModules() {
        logger.info('SYSTEM', 'Initializing core modules');
        
        // Components manager injects common UI elements
        this.componentsManager = new ComponentsManager();
        
        // Navigation is only needed on main page and directory page, not city pages
        if (this.isMainPage || this.isDirectoryPage) {
            this.navigationManager = new NavigationManager();
        } else {
            logger.debug('SYSTEM', 'Skipping navigation manager for city pages (using city switcher instead)');
        }
        
        // Page effects are needed on all pages
        this.pageEffectsManager = new PageEffectsManager();
        
        // Forms are needed on pages that have forms
        this.formsManager = new FormsManager();
        
        // Make formsManager globally accessible for modal interactions
        window.formsManager = this.formsManager;
        
        // Initialize debug overlay if debug parameter is present
        this.initializeDebugOverlay();
        
        // Initialize city renderer on main page
        if (this.isMainPage) {
            this.initializeCityRenderer();
            this.initializeBearEventRenderer();
            this.initializeDadJokes();
            this.initializeTodayEvents();
        }
        
        logger.componentLoad('SYSTEM', 'Core modules initialized');
    }

    initializeDebugOverlay() {
        const urlParams = new URLSearchParams(window.location.search);
        const shouldShow = urlParams.get('debug') === 'true' || urlParams.has('debug');
        
        logger.info('SYSTEM', 'Debug overlay initialization check', {
            shouldShow,
            debugParam: urlParams.get('debug'),
            hasDebugParam: urlParams.has('debug'),
            url: window.location.href,
            debugOverlayClass: typeof window.DebugOverlay
        });
        
        if (shouldShow && window.DebugOverlay) {
            try {
                this.debugOverlay = new window.DebugOverlay();
                window.debugOverlay = this.debugOverlay; // Make globally accessible
                logger.componentInit('SYSTEM', 'Debug overlay initialized in app');
            } catch (error) {
                logger.componentError('SYSTEM', 'Failed to initialize debug overlay', error);
            }
        } else if (shouldShow && !window.DebugOverlay) {
            logger.warn('SYSTEM', 'Debug overlay requested but DebugOverlay class not available');
        }
    }

    initializeCityRenderer() {
        if (window.CityRenderer) {
            this.cityRenderer = new window.CityRenderer();
            this.cityRenderer.init();
            window.cityRenderer = this.cityRenderer; // Make globally accessible
            logger.componentInit('SYSTEM', 'City renderer initialized in app');
        } else {
            logger.warn('SYSTEM', 'CityRenderer not available');
        }
    }

    initializeBearEventRenderer() {
        if (window.BearEventRenderer) {
            this.bearEventRenderer = new window.BearEventRenderer();
            this.bearEventRenderer.init();
            window.bearEventRenderer = this.bearEventRenderer; // Make globally accessible
            logger.componentInit('SYSTEM', 'Bear event renderer initialized in app');
        } else {
            logger.warn('SYSTEM', 'BearEventRenderer not available');
        }
    }

    initializeDadJokes() {
        if (window.DadJokesManager) {
            this.dadJokesManager = new DadJokesManager();
            window.dadJokesManager = this.dadJokesManager; // Make globally accessible
            logger.componentInit('SYSTEM', 'Dad jokes manager initialized in app');
        } else {
            logger.warn('SYSTEM', 'DadJokesManager not available');
        }
    }

    initializeTodayEvents() {
        if (window.TodayEventsAggregator) {
            this.todayEventsAggregator = new TodayEventsAggregator();
            window.todayEventsAggregator = this.todayEventsAggregator; // Make globally accessible
            this.todayEventsAggregator.init();
            logger.componentInit('SYSTEM', 'Today events aggregator initialized in app');
        } else {
            logger.warn('SYSTEM', 'TodayEventsAggregator not available');
        }
    }



    async initializeCityPageModules() {
        const pageType = this.isTestPage ? 'test page' : this.isCityPage ? 'city page' : 'main page';
        logger.info('SYSTEM', `Initializing ${pageType} modules`);
        
        try {
            
            // Calendar functionality needed on city pages and main page (for today events)
            if (window.DynamicCalendarLoader) {
                this.calendarLoader = new DynamicCalendarLoader();
                // Make it globally accessible for backward compatibility
                window.calendarLoader = this.calendarLoader;
                
                // Only initialize full calendar on city/test pages, not main page
                // Run calendar initialization asynchronously to not block other page elements
                if (this.isCityPage || this.isTestPage) {
                    // Don't await - let calendar load in background
                    this.calendarLoader.init().catch(error => {
                        logger.componentError('SYSTEM', 'Calendar initialization failed (non-blocking)', error);
                        // Ensure error is not re-thrown to prevent unhandled promise rejection
                        return null;
                    });
                }
            } else {
                logger.warn('SYSTEM', 'DynamicCalendarLoader not available');
            }
            
            const pageType = this.isTestPage ? 'test page' : this.isCityPage ? 'city page' : 'main page';
            logger.componentLoad('SYSTEM', `${pageType} modules initialized (calendar loading in background)`);
        } catch (error) {
            const pageType = this.isTestPage ? 'test page' : this.isCityPage ? 'city page' : 'main page';
            logger.componentError('SYSTEM', `${pageType} module initialization failed`, error);
        }
    }

    async initializeDirectoryPageModules() {
        logger.info('SYSTEM', 'Initializing directory page modules');
        
        try {
            // Initialize bear directory
            if (window.bearDirectory) {
                this.bearDirectory = window.bearDirectory;
                await this.bearDirectory.init();
            } else {
                logger.warn('SYSTEM', 'BearDirectory not available');
            }
            
            logger.componentLoad('SYSTEM', 'Directory page modules initialized');
        } catch (error) {
            logger.componentError('SYSTEM', 'Directory page module initialization failed', error);
        }
    }

    // Public methods for manual module access
    getNavigationManager() {
        return this.navigationManager;
    }

    getPageEffectsManager() {
        return this.pageEffectsManager;
    }

    getFormsManager() {
        return this.formsManager;
    }

    getCalendarLoader() {
        return this.calendarLoader;
    }

    getBearDirectory() {
        return this.bearDirectory;
    }

    getDebugOverlay() {
        return this.debugOverlay;
    }

    getCityRenderer() {
        return this.cityRenderer;
    }

    getBearEventRenderer() {
        return this.bearEventRenderer;
    }

    getTodayEventsAggregator() {
        return this.todayEventsAggregator;
    }

    getPathUtils() {
        return this.pathUtils;
    }



}

// Initialize the app when DOM is ready
let chunkyApp = null;

function initializeApp() {
    if (!chunkyApp) {
        chunkyApp = new ChunkyDadApp();
        
        // Make app globally accessible for debugging
        window.chunkyApp = chunkyApp;
        
        // Expose global functions for backward compatibility
        // (No global functions needed currently)
    }
}

// Initialize when DOM content is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM already loaded
    initializeApp();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChunkyDadApp;
} else {
    window.ChunkyDadApp = ChunkyDadApp;
}
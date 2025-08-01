// Global error handlers
window.addEventListener('unhandledrejection', function(event) {
    logger.error('SYSTEM', 'Unhandled promise rejection', {
        reason: event.reason,
        promise: event.promise,
        message: event.reason?.message || 'Unknown error',
        stack: event.reason?.stack || 'No stack trace'
    });
    
    // Don't prevent default - let errors show in console
    // event.preventDefault();
});

window.addEventListener('error', function(event) {
    logger.error('SYSTEM', 'Global error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
        stack: event.error?.stack
    });
});

// Main Application Module - Coordinates all other modules and handles initialization
class ChunkyDadApp {
    constructor() {
        this.isMainPage = this.checkIfMainPage();
        this.isCityPage = this.checkIfCityPage();
        this.isTestPage = this.checkIfTestPage();
        this.isDirectoryPage = this.checkIfDirectoryPage();
        
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
        return window.location.pathname.includes('city.html');
    }

    checkIfTestPage() {
        return window.location.pathname.includes('test-calendar-logging.html');
    }

    checkIfDirectoryPage() {
        return window.location.pathname.includes('bear-directory.html');
    }

    async init() {
        try {
            // Always initialize core modules
            this.initializeCoreModules();
            
            // Initialize page-specific modules
            if (this.isCityPage || this.isTestPage) {
                await this.initializeCityPageModules();
            }
            
            if (this.isDirectoryPage) {
                await this.initializeDirectoryPageModules();
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
        
        // Navigation is needed on all pages
        this.navigationManager = new NavigationManager();
        
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
        }
        
        logger.componentLoad('SYSTEM', 'Core modules initialized');
    }

    initializeDebugOverlay() {
        const urlParams = new URLSearchParams(window.location.search);
        const shouldShow = urlParams.get('debug') === 'true' || urlParams.has('debug');
        
        if (shouldShow && window.DebugOverlay) {
            this.debugOverlay = new window.DebugOverlay();
            window.debugOverlay = this.debugOverlay; // Make globally accessible
            logger.componentInit('SYSTEM', 'Debug overlay initialized in app');
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

    async initializeCityPageModules() {
        const pageType = this.isTestPage ? 'test page' : 'city page';
        logger.info('SYSTEM', `Initializing ${pageType} modules`);
        
        try {
            // Calendar functionality is only needed on city pages
            if (window.DynamicCalendarLoader) {
                this.calendarLoader = new DynamicCalendarLoader();
                // Make it globally accessible for backward compatibility
                window.calendarLoader = this.calendarLoader;
                await this.calendarLoader.init();
            } else {
                logger.warn('SYSTEM', 'DynamicCalendarLoader not available');
            }
            
            const pageType = this.isTestPage ? 'test page' : 'city page';
            logger.componentLoad('SYSTEM', `${pageType} modules initialized`);
        } catch (error) {
            const pageType = this.isTestPage ? 'test page' : 'city page';
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

    // Global function for scrolling (backward compatibility)
    scrollToSection(sectionId) {
        if (this.navigationManager) {
            this.navigationManager.scrollToSection(sectionId);
        } else {
            logger.warn('NAV', 'Navigation manager not available for scrolling');
        }
    }

    // Update header when city changes (for city pages)
    updateHeaderForCity(cityKey) {
        if (window.headerManager) {
            window.headerManager.updateForCity(cityKey);
        } else {
            logger.warn('SYSTEM', 'Header manager not available for city update');
        }
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
        window.scrollToSection = (sectionId) => chunkyApp.scrollToSection(sectionId);
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
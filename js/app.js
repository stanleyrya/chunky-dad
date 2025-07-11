// Main Application Module - Coordinates all other modules and handles initialization
class ChunkyDadApp {
    constructor() {
        this.isMainPage = this.checkIfMainPage();
        this.isCityPage = this.checkIfCityPage();
        
        // Initialize modules
        this.navigationManager = null;
        this.pageEffectsManager = null;
        this.formsManager = null;
        this.calendarLoader = null;
        
        logger.componentInit('SYSTEM', 'Chunky Dad App initializing', {
            isMainPage: this.isMainPage,
            isCityPage: this.isCityPage,
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

    async init() {
        try {
            // Always initialize core modules
            this.initializeCoreModules();
            
            // Initialize page-specific modules
            if (this.isCityPage) {
                await this.initializeCityPageModules();
            }
            
            logger.componentLoad('SYSTEM', 'Chunky Dad App initialization complete');
        } catch (error) {
            logger.componentError('SYSTEM', 'App initialization failed', error);
        }
    }

    initializeCoreModules() {
        logger.info('SYSTEM', 'Initializing core modules');
        
        // Navigation is needed on all pages
        this.navigationManager = new NavigationManager();
        
        // Page effects are needed on all pages
        this.pageEffectsManager = new PageEffectsManager();
        
        // Forms are needed on pages that have forms
        this.formsManager = new FormsManager();
        
        logger.componentLoad('SYSTEM', 'Core modules initialized');
    }

    async initializeCityPageModules() {
        logger.info('SYSTEM', 'Initializing city page modules');
        
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
            
            logger.componentLoad('SYSTEM', 'City page modules initialized');
        } catch (error) {
            logger.componentError('SYSTEM', 'City page module initialization failed', error);
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

    // Global function for scrolling (backward compatibility)
    scrollToSection(sectionId) {
        if (this.navigationManager) {
            this.navigationManager.scrollToSection(sectionId);
        } else {
            logger.warn('NAV', 'Navigation manager not available for scrolling');
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
// Main Application Module - Coordinates all other modules and handles initialization
class ChunkyDadApp {
    constructor() {
        this.isMainPage = this.checkIfMainPage();
        this.isCityPage = this.checkIfCityPage();
        this.isTestPage = this.checkIfTestPage();
        
        // Initialize modules
        this.navigationManager = null;
        this.pageEffectsManager = null;
        this.formsManager = null;
        this.calendarLoader = null;
        
        logger.componentInit('SYSTEM', 'chunky.dad App initializing', {
            isMainPage: this.isMainPage,
            isCityPage: this.isCityPage,
            isTestPage: this.isTestPage,
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

    async init() {
        try {
            // Always initialize core modules
            this.initializeCoreModules();
            
            // Initialize page-specific modules
            if (this.isCityPage || this.isTestPage) {
                await this.initializeCityPageModules();
            }
            
            logger.componentLoad('SYSTEM', 'chunky.dad App initialization complete');
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
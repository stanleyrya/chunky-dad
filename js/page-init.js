// Page Initialization Module - Coordinates all other modules and handles page-specific setup
class PageInitializer {
    constructor() {
        this.isMainPage = this.checkIfMainPage();
        this.isCityPage = this.checkIfCityPage();
        this.initializeApplication();
    }

    checkIfMainPage() {
        return window.location.pathname.endsWith('index.html') || 
               window.location.pathname === '/' || 
               window.location.pathname === '';
    }

    checkIfCityPage() {
        return window.location.pathname.includes('city.html');
    }

    initializeApplication() {
        // Wait for all modules to be available
        this.waitForModules().then(() => {
            this.setupPageSpecificBehavior();
            this.logInitializationComplete();
        });
    }

    async waitForModules() {
        // Wait for other modules to initialize
        const checkModules = () => {
            return new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    // Check if required modules are loaded
                    const modulesLoaded = window.navigationManager && 
                                         window.uiEffectsManager && 
                                         window.formHandler;
                    
                    if (modulesLoaded) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 50);
            });
        };

        return checkModules();
    }

    setupPageSpecificBehavior() {
        if (this.isMainPage) {
            this.setupMainPageBehavior();
        } else if (this.isCityPage) {
            this.setupCityPageBehavior();
        }
    }

    setupMainPageBehavior() {
        console.log('Setting up main page behavior');
        
        // Main page specific initializations can go here
        // For example, special analytics tracking, main page specific event listeners, etc.
    }

    setupCityPageBehavior() {
        console.log('Setting up city page behavior');
        
        // Initialize calendar manager if available
        if (typeof DynamicCalendarLoader !== 'undefined') {
            window.calendarLoader = new DynamicCalendarLoader();
            window.calendarLoader.init();
        }
        
        // City page specific initializations can go here
    }

    logInitializationComplete() {
        console.log('Page initialization complete', {
            isMainPage: this.isMainPage,
            isCityPage: this.isCityPage,
            pathname: window.location.pathname
        });
    }
}

// Initialize page when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.pageInitializer = new PageInitializer();
    });
} else {
    window.pageInitializer = new PageInitializer();
}
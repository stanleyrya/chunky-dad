// Header Manager - Dynamic header functionality for city pages and debug options
class HeaderManager {
    constructor() {
        this.logger = window.logger || console;
        this.currentCity = null;
        this.isTestPage = this.detectTestPage();
        this.init();
    }

    init() {
        this.logger.componentInit('HEADER', 'Initializing header manager');
        this.setupHeader();
        this.setupDebugOptions();
    }

    detectTestPage() {
        const path = window.location.pathname;
        return path.includes('test') || path.includes('god-mode') || path.includes('testing');
    }

    setupHeader() {
        const header = document.querySelector('header');
        if (!header) {
            this.logger.componentError('HEADER', 'Header element not found');
            return;
        }

        // Skip header setup for city pages - they use pure HTML/CSS
        if (this.isCityPage()) {
            this.logger.componentLoad('HEADER', 'Skipping header setup - city pages use pure HTML/CSS');
            return;
        }

        // Update header title based on page type (for non-city pages)
        this.updateHeaderTitle();
    }


    updateHeaderTitle() {
        const logoElement = document.querySelector('.logo h1');
        if (!logoElement) {
            this.logger.componentError('HEADER', 'Logo element not found');
            return;
        }

        const logoPath = window.pathUtils ? window.pathUtils.getLogoPath() : 'Rising_Star_Ryan_Head_Compressed.png';
        let title = `<img src="${logoPath}" alt="chunky.dad logo" class="logo-img"> chunky.dad`;
        
        if (this.isCityPage()) {
            const cityKey = this.getCityFromURL();
            const cityConfig = getCityConfig(cityKey);
            if (cityConfig) {
                title = `<img src="${logoPath}" alt="chunky.dad logo" class="logo-img"> chunky.dad/${cityKey}`;
                this.currentCity = cityConfig;
            }
        } else if (this.isTestPage) {
            title = `<img src="${logoPath}" alt="chunky.dad logo" class="logo-img"> chunky.dad [DEBUG]`;
        }

        // Update the title
        if (logoElement.querySelector('a')) {
            logoElement.querySelector('a').innerHTML = title;
        } else {
            logoElement.innerHTML = title;
        }

        this.logger.componentLoad('HEADER', `Header title updated: ${title}`);
    }


    isCityPage() {
        // Check for both legacy city.html format and new city subdirectory format
        if (window.location.pathname.includes('city.html')) {
            return true;
        }
        
        // Check if we're in a city subdirectory using app.js logic
        if (window.chunkyApp && window.chunkyApp.getCitySlugFromPath) {
            const citySlug = window.chunkyApp.getCitySlugFromPath();
            return !!citySlug;
        }
        
        // Fallback detection for city subdirectories
        const pathname = window.location.pathname;
        const pathSegments = pathname.split('/').filter(Boolean);
        
        if (pathSegments.length > 0) {
            const firstSegment = pathSegments[0].toLowerCase();
            // Check if first segment matches a known city
            if (window.CITY_CONFIG && window.CITY_CONFIG[firstSegment]) {
                return true;
            }
        }
        
        return false;
    }

    getCityFromURL() {
        // First try URL parameters (legacy city.html format)
        const urlParams = new URLSearchParams(window.location.search);
        const cityParam = urlParams.get('city');
        if (cityParam) {
            return cityParam;
        }
        
        // Then try path-based detection (new subdirectory format)
        if (window.chunkyApp && window.chunkyApp.getCitySlugFromPath) {
            return window.chunkyApp.getCitySlugFromPath();
        }
        
        // Fallback path detection
        const pathname = window.location.pathname;
        const pathSegments = pathname.split('/').filter(Boolean);
        
        if (pathSegments.length > 0) {
            const firstSegment = pathSegments[0].toLowerCase();
            if (window.CITY_CONFIG && window.CITY_CONFIG[firstSegment]) {
                return firstSegment;
            }
        }
        
        return null;
    }



    setupDebugOptions() {
        if (!this.isTestPage) return;

        // Add debug info to header
        const navContainer = document.querySelector('.nav-container');
        if (!navContainer) return;

        const debugInfo = document.createElement('div');
        debugInfo.className = 'debug-info';
        debugInfo.innerHTML = `
            <span class="debug-label">DEBUG:</span>
            <span class="debug-page">${window.location.pathname}</span>
        `;
        navContainer.appendChild(debugInfo);

        this.logger.componentLoad('HEADER', 'Debug info added to test page');
    }


}

function initHeaderWhenReady() {
  const logger = window.logger || console;
  logger.info('SYSTEM', '🚀 DOM ready event fired - initializing header manager', {
    readyState: document.readyState,
    timestamp: new Date().toISOString()
  });
  
  requestAnimationFrame(() => {
    logger.componentInit('SYSTEM', 'Header manager instantiation starting');
    window.headerManager = new HeaderManager();
    logger.componentLoad('SYSTEM', 'Header manager successfully instantiated and ready');
  });
}

if (document.readyState === "loading") {
  const logger = window.logger || console;
  logger.debug('SYSTEM', 'Document still loading - waiting for DOMContentLoaded event');
  document.addEventListener("DOMContentLoaded", initHeaderWhenReady);
} else {
  const logger = window.logger || console;
  logger.debug('SYSTEM', 'Document already loaded - initializing header manager immediately');
  initHeaderWhenReady();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderManager;
}
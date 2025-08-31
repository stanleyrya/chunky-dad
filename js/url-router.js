// URL Router Module - Handles friendly city URLs and client-side routing
class URLRouter {
    constructor() {
        this.cityConfig = window.CITY_CONFIG || {};
        this.logger = window.logger;
        this.init();
    }

    init() {
        this.logger.componentInit('SYSTEM', 'URL Router initializing');
        
        // Handle routing on page load
        this.handleInitialRoute();
        
        // Listen for browser back/forward navigation
        window.addEventListener('popstate', (event) => {
            this.logger.userInteraction('SYSTEM', 'Browser navigation detected', {
                pathname: window.location.pathname,
                state: event.state
            });
            this.handleRoute();
        });
        
        this.logger.componentLoad('SYSTEM', 'URL Router initialized');
    }

    handleInitialRoute() {
        const path = window.location.pathname;
        const cityKey = this.extractCityFromPath(path);
        
        this.logger.info('SYSTEM', 'Processing initial route', {
            originalPath: path,
            extractedCity: cityKey,
            isCityRoute: !!cityKey
        });

        if (cityKey) {
            this.handleCityRoute(cityKey);
        }
    }

    handleRoute() {
        const path = window.location.pathname;
        const cityKey = this.extractCityFromPath(path);
        
        if (cityKey) {
            this.handleCityRoute(cityKey);
        }
    }

    extractCityFromPath(path) {
        // Remove leading/trailing slashes and get the first segment
        const segments = path.replace(/^\/+|\/+$/g, '').split('/');
        const potentialCity = segments[0];
        
        // Check if this matches a known city key
        if (potentialCity && this.cityConfig[potentialCity]) {
            return potentialCity;
        }
        
        return null;
    }

    handleCityRoute(cityKey) {
        const cityConfig = this.cityConfig[cityKey];
        
        if (!cityConfig) {
            this.logger.error('SYSTEM', 'City not found in configuration', { cityKey });
            this.handleCityNotFound(cityKey);
            return;
        }

        this.logger.info('SYSTEM', 'Handling city route', {
            cityKey,
            cityName: cityConfig.name,
            currentPath: window.location.pathname
        });

        // Check if we're already on the city page
        if (window.location.pathname.includes('city.html')) {
            // Already on city page, just update the city parameter
            this.updateCityOnCurrentPage(cityKey);
        } else {
            // Need to navigate to city page
            this.navigateToCityPage(cityKey);
        }
    }

    updateCityOnCurrentPage(cityKey) {
        this.logger.info('SYSTEM', 'Updating city on current page', { cityKey });
        
        // Update URL without page reload to show friendly URL
        const friendlyUrl = `/${cityKey}`;
        window.history.replaceState({ cityKey }, '', friendlyUrl);
        
        // Update Google Analytics page view
        this.trackPageView(friendlyUrl, `${this.cityConfig[cityKey].name} - chunky.dad`);
        
        // Trigger city update if calendar loader is available
        if (window.calendarLoader && window.calendarLoader.loadCityCalendar) {
            window.calendarLoader.loadCityCalendar(cityKey);
        }
        
        // Update header for city
        if (window.chunkyApp && window.chunkyApp.updateHeaderForCity) {
            window.chunkyApp.updateHeaderForCity(cityKey);
        }
    }

    navigateToCityPage(cityKey) {
        this.logger.info('SYSTEM', 'Navigating to city page', { cityKey });
        
        // Use pushState to navigate without page reload
        const friendlyUrl = `/${cityKey}`;
        window.history.pushState({ cityKey }, '', friendlyUrl);
        
        // Load city.html content dynamically
        this.loadCityPageContent(cityKey);
    }

    async loadCityPageContent(cityKey) {
        try {
            this.logger.time('SYSTEM', 'Loading city page content');
            
            // Fetch city.html content
            const response = await fetch('/city.html');
            if (!response.ok) {
                throw new Error(`Failed to load city page: ${response.status}`);
            }
            
            const html = await response.text();
            
            // Create a temporary container to parse the HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            
            // Extract the main content (everything inside body except scripts)
            const bodyContent = tempDiv.querySelector('body');
            const scripts = bodyContent.querySelectorAll('script');
            
            // Remove scripts from the content (we'll handle them separately)
            scripts.forEach(script => script.remove());
            
            // Replace current page content
            document.body.innerHTML = bodyContent.innerHTML;
            
            // Update page title and meta
            const cityConfig = this.cityConfig[cityKey];
            document.title = `${cityConfig.name} - chunky.dad Bear Guide`;
            
            // Update meta description
            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc) {
                metaDesc.content = `Gay bear guide to ${cityConfig.name} - events, bars, and the hottest bear scene`;
            }
            
            // Track page view with friendly URL
            this.trackPageView(`/${cityKey}`, `${cityConfig.name} - chunky.dad`);
            
            // Reinitialize the app for the new content
            await this.reinitializeApp(cityKey);
            
            this.logger.timeEnd('SYSTEM', 'Loading city page content');
            this.logger.componentLoad('SYSTEM', 'City page content loaded successfully', { cityKey });
            
        } catch (error) {
            this.logger.componentError('SYSTEM', 'Failed to load city page content', error);
            this.handleRouteError(cityKey, error);
        }
    }

    async reinitializeApp(cityKey) {
        try {
            // Reinitialize the chunky dad app with the new content
            if (window.ChunkyDadApp) {
                // Create new app instance
                window.chunkyApp = new window.ChunkyDadApp();
                
                // Set the city parameter for the calendar loader
                if (window.calendarLoader) {
                    // Override the getCityFromURL method to return our city
                    window.calendarLoader.getCityFromURL = () => cityKey;
                }
            }
        } catch (error) {
            this.logger.componentError('SYSTEM', 'Failed to reinitialize app', error);
        }
    }

    handleCityNotFound(cityKey) {
        this.logger.warn('SYSTEM', 'City not found, showing error page', { cityKey });
        
        // Show city not found section
        const notFoundSection = document.querySelector('.city-not-found');
        const cityPageSection = document.querySelector('.city-page');
        
        if (notFoundSection) {
            notFoundSection.style.display = 'block';
        }
        if (cityPageSection) {
            cityPageSection.style.display = 'none';
        }
        
        // Populate available cities list
        this.populateAvailableCities();
        
        // Update page title
        document.title = 'City Not Found - chunky.dad';
        
        // Track 404 page view
        this.trackPageView(`/${cityKey}`, 'City Not Found - chunky.dad');
    }

    populateAvailableCities() {
        const container = document.getElementById('available-cities-list');
        if (!container) return;
        
        const cities = Object.keys(this.cityConfig)
            .filter(key => this.cityConfig[key].visible !== false)
            .map(key => {
                const config = this.cityConfig[key];
                return `<a href="/${key}" class="city-link">${config.emoji} ${config.name}</a>`;
            })
            .join('');
        
        container.innerHTML = cities;
        
        // Add click handlers for the new links
        container.querySelectorAll('.city-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                const cityKey = href.replace('/', '');
                this.navigateToCity(cityKey);
            });
        });
    }

    handleRouteError(cityKey, error) {
        this.logger.componentError('SYSTEM', 'Route handling failed', { cityKey, error });
        
        // Fallback to traditional URL
        const fallbackUrl = `/city.html?city=${cityKey}`;
        this.logger.info('SYSTEM', 'Falling back to traditional URL', { fallbackUrl });
        window.location.href = fallbackUrl;
    }

    // Public method to navigate to a city with friendly URL
    navigateToCity(cityKey) {
        if (!this.cityConfig[cityKey]) {
            this.logger.error('SYSTEM', 'Cannot navigate to unknown city', { cityKey });
            return;
        }
        
        this.logger.userInteraction('SYSTEM', 'Navigating to city via router', { cityKey });
        
        const friendlyUrl = `/${cityKey}`;
        window.history.pushState({ cityKey }, '', friendlyUrl);
        this.handleCityRoute(cityKey);
    }

    // Enhanced analytics tracking for friendly URLs
    // This ensures consistent analytics tracking regardless of how the page was accessed:
    // - Direct access to /seattle tracks as "/seattle" 
    // - Navigation from index tracks as "/seattle"
    // - Traditional city.html?city=seattle would track as "/seattle" if routed through this system
    trackPageView(path, title) {
        if (typeof gtag !== 'undefined') {
            // Track the friendly URL path, not the underlying city.html
            // This provides consistent analytics regardless of access method
            gtag('config', 'G-YKQBFFQR5E', {
                page_title: title,
                page_location: window.location.origin + path
            });
            
            // Send page view event with the canonical friendly URL
            gtag('event', 'page_view', {
                page_title: title,
                page_location: window.location.origin + path,
                custom_parameters: {
                    access_method: window.CITY_PAGE_CONFIG?.friendlyUrl ? 'friendly_url' : 'traditional_url'
                }
            });
            
            this.logger.info('SYSTEM', 'Analytics page view tracked', {
                path,
                title,
                fullUrl: window.location.origin + path,
                accessMethod: window.CITY_PAGE_CONFIG?.friendlyUrl ? 'friendly_url' : 'traditional_url'
            });
        } else {
            this.logger.warn('SYSTEM', 'Google Analytics not available for tracking');
        }
    }

    // Helper method to get current city from URL
    getCurrentCity() {
        return this.extractCityFromPath(window.location.pathname);
    }

    // Helper method to generate friendly URL for a city
    getFriendlyUrl(cityKey) {
        return `/${cityKey}`;
    }

    // Helper method to check if current URL is a friendly city URL
    isFriendlyUrl() {
        return !!this.extractCityFromPath(window.location.pathname);
    }
}

// Make URLRouter globally available
window.URLRouter = URLRouter;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = URLRouter;
}
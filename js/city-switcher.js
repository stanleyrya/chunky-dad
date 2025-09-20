// City Switcher Module - Handles city switcher injection for city pages
class CitySwitcher {
    constructor() {
        this.init();
    }

    init() {
        logger.componentInit('CITY', 'City switcher initializing');
        this.injectCitySwitcher();
        logger.componentLoad('CITY', 'City switcher initialized');
    }

    injectCitySwitcher() {
        const container = document.getElementById('city-switcher-container');
        if (!container) {
            logger.warn('CITY', 'City switcher container not found');
            return;
        }

        // Get current city from URL or default to 'city'
        const currentCity = this.getCurrentCity();
        const cityConfig = this.getCityConfig(currentCity);
        
        if (!cityConfig) {
            logger.warn('CITY', 'City configuration not found', { currentCity });
            return;
        }

        const citySwitcherHTML = this.generateCitySwitcherHTML(currentCity, cityConfig);
        container.innerHTML = citySwitcherHTML;
        
        logger.componentLoad('CITY', 'City switcher injected', { currentCity });
    }

    getCurrentCity() {
        try {
            const url = new URL(window.location.href);
            const cityParam = url.searchParams.get('city');
            if (cityParam) {
                return cityParam.toLowerCase().trim().replace(/\s+/g, '-');
            }
            
            // Try to get from pathname
            const pathname = window.location.pathname;
            if (pathname.includes('city.html')) {
                return 'city'; // Default fallback
            }
            
            return 'city';
        } catch (e) {
            logger.warn('CITY', 'Failed to get current city from URL', { error: e.message });
            return 'city';
        }
    }

    getCityConfig(citySlug) {
        if (!window.CITY_CONFIG || !window.CITY_CONFIG[citySlug]) {
            // Return a default config for the fallback city page
            return {
                name: 'City',
                emoji: '🏙️',
                aliases: []
            };
        }
        return window.CITY_CONFIG[citySlug];
    }

    generateCitySwitcherHTML(currentCity, cityConfig) {
        const allCities = this.getAllCities();
        
        return `
            <input type="checkbox" id="city-switcher-toggle" class="city-switcher-toggle">
            <label for="city-switcher-toggle" class="city-switcher-btn" aria-label="Switch city - currently ${cityConfig.name}">
                <span class="city-emoji">${cityConfig.emoji}</span>
                <span class="city-name">${cityConfig.name}</span>
                <span class="city-carrot">▼</span>
            </label>
            <div class="city-dropdown">
                ${allCities.map(city => `
                    <a href="${city.url}" class="city-option">
                        <span class="city-option-emoji">${city.emoji}</span>
                        <span class="city-option-name">${city.name}</span>
                    </a>
                `).join('')}
            </div>
        `;
    }

    getAllCities() {
        if (!window.CITY_CONFIG) {
            return [];
        }

        return Object.entries(window.CITY_CONFIG)
            .filter(([slug, config]) => config && config.name && config.emoji)
            .map(([slug, config]) => ({
                slug,
                name: config.name,
                emoji: config.emoji,
                url: `../${slug}/`
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CitySwitcher;
} else {
    window.CitySwitcher = CitySwitcher;
}
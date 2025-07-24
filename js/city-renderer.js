// City Renderer - Dynamically renders city cards from configuration
class CityRenderer {
    constructor() {
        this.cityContainer = null;
        logger.componentInit('CITY', 'City renderer initializing');
    }

    init() {
        this.cityContainer = document.querySelector('.city-compact-grid');
        if (!this.cityContainer) {
            logger.warn('CITY', 'City container not found');
            return;
        }

        this.renderCities();
        logger.componentLoad('CITY', 'City renderer initialized');
    }

    renderCities() {
        if (!window.getAvailableCities) {
            logger.error('CITY', 'City configuration not available');
            return;
        }

        const cities = getAvailableCities();
        logger.info('CITY', 'Rendering cities dynamically', { count: cities.length });

        // Clear existing content
        this.cityContainer.innerHTML = '';

        // Render each city
        cities.forEach(city => {
            const cityCard = this.createCityCard(city);
            this.cityContainer.appendChild(cityCard);
        });

        // Add "More Cities" card
        const moreCitiesCard = this.createMoreCitiesCard();
        this.cityContainer.appendChild(moreCitiesCard);

        logger.componentLoad('CITY', 'Cities rendered successfully', { count: cities.length });
    }

    createCityCard(city) {
        const link = document.createElement('a');
        link.href = `city.html?city=${city.key}`;
        link.className = 'city-compact-card';

        const emoji = document.createElement('span');
        emoji.className = 'city-emoji';
        emoji.textContent = city.emoji;

        const name = document.createElement('span');
        name.className = 'city-name';
        name.textContent = city.name;

        link.appendChild(emoji);
        link.appendChild(name);

        return link;
    }

    createMoreCitiesCard() {
        const card = document.createElement('div');
        card.className = 'city-compact-card coming-soon';

        const emoji = document.createElement('span');
        emoji.className = 'city-emoji';
        emoji.textContent = '🌍';

        const name = document.createElement('span');
        name.className = 'city-name';
        name.textContent = 'More Cities';

        card.appendChild(emoji);
        card.appendChild(name);

        return card;
    }
}

// Initialize when DOM is ready
function initializeCityRenderer() {
    const cityRenderer = new CityRenderer();
    cityRenderer.init();
    
    // Make globally accessible
    window.cityRenderer = cityRenderer;
}

// Auto-initialize on main page
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Only initialize on main page
        const isMainPage = window.location.pathname.endsWith('index.html') || 
                          window.location.pathname === '/' || 
                          window.location.pathname === '';
        if (isMainPage) {
            initializeCityRenderer();
        }
    });
} else {
    // DOM already loaded
    const isMainPage = window.location.pathname.endsWith('index.html') || 
                      window.location.pathname === '/' || 
                      window.location.pathname === '';
    if (isMainPage) {
        initializeCityRenderer();
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CityRenderer;
} else {
    window.CityRenderer = CityRenderer;
}
// Header Manager - Handles dynamic header functionality
class HeaderManager {
    constructor() {
        this.currentCity = null;
        this.isCityPage = window.location.pathname.includes('city.html');
        this.isTestPage = window.location.pathname.includes('test-');
        this.isDebugMode = this.isTestPage;
        
        logger.componentInit('HEADER', 'Header Manager initializing', {
            isCityPage: this.isCityPage,
            isTestPage: this.isTestPage,
            isDebugMode: this.isDebugMode
        });
        
        this.init();
    }

    init() {
        try {
            this.setupHeader();
            this.setupCitySelector();
            this.updateHeaderTitle();
            
            logger.componentLoad('HEADER', 'Header Manager initialized successfully');
        } catch (error) {
            logger.componentError('HEADER', 'Header Manager initialization failed', error);
        }
    }

    setupHeader() {
        const logo = document.querySelector('.logo h1');
        if (!logo) {
            logger.warn('HEADER', 'Logo element not found');
            return;
        }

        // Clear existing content
        logo.innerHTML = '';
        
        // Create the main logo link
        const logoLink = document.createElement('a');
        logoLink.href = 'index.html';
        logoLink.className = 'logo-link';
        
        // Add bear emoji and text
        const bearEmoji = document.createElement('span');
        bearEmoji.textContent = '🐻';
        bearEmoji.className = 'bear-emoji';
        
        const logoText = document.createElement('span');
        logoText.className = 'logo-text';
        logoText.textContent = 'Chunky Dad';
        
        logoLink.appendChild(bearEmoji);
        logoLink.appendChild(logoText);
        logo.appendChild(logoLink);
        
        logger.debug('HEADER', 'Header logo setup complete');
    }

    setupCitySelector() {
        if (!this.isCityPage) {
            return;
        }

        const navContainer = document.querySelector('.nav-container');
        if (!navContainer) {
            logger.warn('HEADER', 'Nav container not found for city selector');
            return;
        }

        // Create city selector container
        const citySelector = document.createElement('div');
        citySelector.className = 'header-city-selector';
        
        // Create emoji button
        const emojiButton = document.createElement('button');
        emojiButton.className = 'city-emoji-button';
        emojiButton.setAttribute('aria-label', 'Select city');
        
        // Create dropdown container
        const dropdown = document.createElement('div');
        dropdown.className = 'city-dropdown-menu';
        dropdown.style.display = 'none';
        
        // Populate dropdown with cities
        this.populateCityDropdown(dropdown);
        
        // Add event listeners
        emojiButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCityDropdown(dropdown);
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!citySelector.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
        
        citySelector.appendChild(emojiButton);
        citySelector.appendChild(dropdown);
        navContainer.appendChild(citySelector);
        
        logger.debug('HEADER', 'City selector setup complete');
    }

    populateCityDropdown(dropdown) {
        const cities = getAvailableCities();
        
        cities.forEach(city => {
            const cityItem = document.createElement('div');
            cityItem.className = 'city-dropdown-item';
            cityItem.setAttribute('data-city', city.key);
            
            const emoji = document.createElement('span');
            emoji.className = 'city-item-emoji';
            emoji.textContent = city.emoji;
            
            const name = document.createElement('span');
            name.className = 'city-item-name';
            name.textContent = city.name;
            
            cityItem.appendChild(emoji);
            cityItem.appendChild(name);
            
            cityItem.addEventListener('click', () => {
                this.selectCity(city.key);
                dropdown.style.display = 'none';
            });
            
            dropdown.appendChild(cityItem);
        });
        
        logger.debug('HEADER', `Populated dropdown with ${cities.length} cities`);
    }

    toggleCityDropdown(dropdown) {
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'block';
        
        logger.userInteraction('HEADER', `City dropdown ${isVisible ? 'closed' : 'opened'}`);
    }

    selectCity(cityKey) {
        const currentUrl = new URL(window.location);
        currentUrl.searchParams.set('city', cityKey);
        window.location.href = currentUrl.toString();
        
        logger.userInteraction('HEADER', `City selected: ${cityKey}`);
    }

    updateHeaderTitle() {
        if (this.isCityPage) {
            this.updateCityPageTitle();
        } else if (this.isDebugMode) {
            this.updateDebugTitle();
        } else {
            this.updateMainPageTitle();
        }
    }

    updateCityPageTitle() {
        const urlParams = new URLSearchParams(window.location.search);
        const cityKey = urlParams.get('city');
        
        if (!cityKey) {
            logger.warn('HEADER', 'No city parameter found in URL');
            return;
        }
        
        const cityConfig = getCityConfig(cityKey);
        if (!cityConfig) {
            logger.warn('HEADER', `City config not found for: ${cityKey}`);
            return;
        }
        
        this.currentCity = cityConfig;
        
        // Update page title
        document.title = `${cityConfig.name} - Chunky Dad Bear Guide`;
        
        // Update emoji button
        const emojiButton = document.querySelector('.city-emoji-button');
        if (emojiButton) {
            emojiButton.textContent = cityConfig.emoji;
        }
        
        // Update logo text to show city
        const logoText = document.querySelector('.logo-text');
        if (logoText) {
            logoText.textContent = `chunky.dad/${cityKey}`;
        }
        
        logger.componentLoad('HEADER', `City page title updated for ${cityConfig.name}`);
    }

    updateDebugTitle() {
        const pageName = window.location.pathname.split('/').pop().replace('.html', '');
        document.title = `Debug: ${pageName} - Chunky Dad`;
        
        const logoText = document.querySelector('.logo-text');
        if (logoText) {
            logoText.textContent = `chunky.dad/debug/${pageName}`;
        }
        
        logger.debug('HEADER', `Debug page title updated: ${pageName}`);
    }

    updateMainPageTitle() {
        document.title = 'Chunky Dad - Your Gay Bear Travel Guide';
        
        const logoText = document.querySelector('.logo-text');
        if (logoText) {
            logoText.textContent = 'chunky.dad';
        }
        
        logger.debug('HEADER', 'Main page title updated');
    }

    // Public method to update header when city changes
    updateForCity(cityKey) {
        const cityConfig = getCityConfig(cityKey);
        if (cityConfig) {
            this.currentCity = cityConfig;
            this.updateHeaderTitle();
            
            logger.componentLoad('HEADER', `Header updated for city: ${cityConfig.name}`);
        }
    }
}

// Initialize when DOM is ready
let headerManager = null;

function initializeHeaderManager() {
    if (!headerManager) {
        headerManager = new HeaderManager();
        window.headerManager = headerManager; // Make globally accessible
    }
}

// Initialize when DOM content is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeHeaderManager);
} else {
    // DOM already loaded
    initializeHeaderManager();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderManager;
} else {
    window.HeaderManager = HeaderManager;
}
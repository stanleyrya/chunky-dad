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
        this.setupCitySelector();
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

        // Update header title based on page type
        this.updateHeaderTitle();
        
        // Add city selector to city pages
        if (this.isCityPage()) {
            this.addCitySelector();
        }
    }

    updateHeaderTitle() {
        const logoElement = document.querySelector('.logo h1');
        if (!logoElement) {
            this.logger.componentError('HEADER', 'Logo element not found');
            return;
        }

        let title = '🐻 Chunky Dad';
        
        if (this.isCityPage()) {
            const cityKey = this.getCityFromURL();
            const cityConfig = getCityConfig(cityKey);
            if (cityConfig) {
                title = `${cityConfig.emoji} chunky.dad/${cityKey}`;
                this.currentCity = cityConfig;
            }
        } else if (this.isTestPage) {
            title = '🐻 Chunky Dad [DEBUG]';
        }

        // Update the title
        if (logoElement.querySelector('a')) {
            logoElement.querySelector('a').textContent = title;
        } else {
            logoElement.textContent = title;
        }

        this.logger.componentLoad('HEADER', `Header title updated: ${title}`);
    }

    isCityPage() {
        return window.location.pathname.includes('city.html');
    }

    getCityFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('city');
    }

    addCitySelector() {
        const navContainer = document.querySelector('.nav-container');
        if (!navContainer) {
            this.logger.componentError('HEADER', 'Nav container not found');
            return;
        }

        // Create city selector container
        const citySelector = document.createElement('div');
        citySelector.className = 'header-city-selector';
        
        // Create emoji button
        const emojiButton = document.createElement('button');
        emojiButton.className = 'city-emoji-button';
        emojiButton.innerHTML = this.currentCity?.emoji || '🏙️';
        emojiButton.setAttribute('aria-label', 'Switch city');
        
        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'city-dropdown-menu';
        dropdown.style.display = 'none';
        
        // Add city options
        const cities = getAvailableCities();
        cities.forEach(city => {
            const cityOption = document.createElement('div');
            cityOption.className = 'city-option';
            cityOption.innerHTML = `
                <span class="city-option-emoji">${city.emoji}</span>
                <span class="city-option-name">${city.name}</span>
            `;
            cityOption.addEventListener('click', () => {
                this.switchCity(city.key);
            });
            dropdown.appendChild(cityOption);
        });

        // Add event listeners
        emojiButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown(dropdown);
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            dropdown.style.display = 'none';
        });

        // Prevent dropdown from closing when clicking inside
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        citySelector.appendChild(emojiButton);
        citySelector.appendChild(dropdown);
        navContainer.appendChild(citySelector);

        this.logger.componentLoad('HEADER', 'City selector added to header');
    }

    toggleDropdown(dropdown) {
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            // Add animation class
            dropdown.classList.add('dropdown-open');
            setTimeout(() => {
                dropdown.classList.remove('dropdown-open');
            }, 300);
        }
    }

    switchCity(cityKey) {
        this.logger.userInteraction('HEADER', `Switching to city: ${cityKey}`);
        window.location.href = `city.html?city=${cityKey}`;
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

    // Public method to update header when city changes
    updateForCity(cityKey) {
        this.logger.componentLoad('HEADER', `Updating header for city: ${cityKey}`);
        this.currentCity = getCityConfig(cityKey);
        this.updateHeaderTitle();
        
        // Update emoji button if it exists
        const emojiButton = document.querySelector('.city-emoji-button');
        if (emojiButton && this.currentCity) {
            emojiButton.innerHTML = this.currentCity.emoji;
        }
    }
}

// Initialize header manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.headerManager = new HeaderManager();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderManager;
}
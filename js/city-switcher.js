// City Switcher - Handles city switching functionality on city pages
class CitySwitcher {
    constructor() {
        this.logger = window.logger || console;
        this.currentCity = null;
        this.init();
    }

    init() {
        this.logger.componentInit('CITY', 'Initializing city switcher');
        this.setupCitySwitcher();
        this.updateCurrentCity();
    }

    setupCitySwitcher() {
        const switcherBtn = document.getElementById('city-switcher-btn');
        const dropdown = document.getElementById('city-dropdown');
        
        if (!switcherBtn || !dropdown) {
            this.logger.componentError('CITY', 'City switcher elements not found');
            return;
        }

        // Populate dropdown with available cities
        this.populateDropdown(dropdown);

        // Add click event to toggle dropdown
        switcherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.logger.userInteraction('CITY', 'City switcher button clicked');
            this.toggleDropdown(dropdown);
        });

        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!switcherBtn.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        };
        
        document.addEventListener('click', closeDropdown);

        // Prevent dropdown from closing when clicking inside
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        this.logger.componentLoad('CITY', 'City switcher setup complete');
    }

    populateDropdown(dropdown) {
        const cities = getAvailableCities();
        
        cities.forEach(city => {
            const cityOption = document.createElement('div');
            cityOption.className = 'city-option';
            cityOption.innerHTML = `
                <span class="city-option-emoji">${city.emoji}</span>
                <span class="city-option-name">${city.name}</span>
            `;
            
            cityOption.addEventListener('click', () => {
                this.logger.userInteraction('CITY', `Switching to city: ${city.key}`);
                this.switchCity(city.key);
            });
            
            dropdown.appendChild(cityOption);
        });

        this.logger.componentLoad('CITY', `Populated dropdown with ${cities.length} cities`);
    }

    toggleDropdown(dropdown) {
        const isOpen = dropdown.classList.contains('open');
        
        if (isOpen) {
            dropdown.classList.remove('open');
            this.logger.debug('CITY', 'Dropdown closed');
        } else {
            dropdown.classList.add('open');
            this.logger.debug('CITY', 'Dropdown opened');
        }
    }

    switchCity(cityKey) {
        this.logger.userInteraction('CITY', `Switching to city: ${cityKey}`);
        window.location.href = `city.html?city=${cityKey}`;
    }

    updateCurrentCity() {
        const cityKey = this.getCityFromURL();
        const cityConfig = getCityConfig(cityKey);
        
        if (cityConfig) {
            this.currentCity = cityConfig;
            this.updateDisplay(cityConfig);
            this.logger.componentLoad('CITY', `Updated display for city: ${cityKey}`);
        } else {
            this.logger.componentError('CITY', `City config not found for: ${cityKey}`);
        }
    }

    getCityFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('city');
    }

    updateDisplay(cityConfig) {
        const emojiElement = document.getElementById('current-city-emoji');
        const nameElement = document.getElementById('current-city-name');
        
        if (emojiElement) {
            emojiElement.textContent = cityConfig.emoji;
        }
        
        if (nameElement) {
            nameElement.textContent = cityConfig.name;
        }
    }

    // Public method to update switcher when city changes
    updateForCity(cityKey) {
        this.logger.componentLoad('CITY', `Updating switcher for city: ${cityKey}`);
        const cityConfig = getCityConfig(cityKey);
        if (cityConfig) {
            this.currentCity = cityConfig;
            this.updateDisplay(cityConfig);
        }
    }
}

// Initialize city switcher when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.citySwitcher = new CitySwitcher();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CitySwitcher;
}
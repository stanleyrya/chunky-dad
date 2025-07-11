// City Selector Module - Handles city selection and management
class CitySelector {
    constructor() {
        this.debugMode = true;
        this.currentCity = null;
        this.currentCityConfig = null;
        this.initialized = false;
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[CitySelector] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[CitySelector ERROR] ${message}`, data || '');
    }

    // Initialize city selector
    initialize() {
        if (this.initialized) return;

        this.currentCity = this.getCityFromURL();
        this.currentCityConfig = getCityConfig(this.currentCity);
        
        if (!this.currentCityConfig) {
            this.showCityNotFound();
            return;
        }

        this.setupCitySelector();
        this.updatePageContent();
        
        this.initialized = true;
        this.log(`City selector initialized for ${this.currentCity}`);
    }

    // Get city from URL parameters
    getCityFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const cityParam = urlParams.get('city');
        
        // If no city parameter, try to get from hash or default to new-york
        if (!cityParam) {
            const hash = window.location.hash.replace('#', '');
            return hash || 'new-york';
        }
        
        return cityParam;
    }

    // Set up city selector and populate with available cities
    setupCitySelector() {
        const citySelect = document.getElementById('city-select');
        const cityButtons = document.getElementById('city-buttons');
        const availableCitiesList = document.getElementById('available-cities-list');
        
        // Setup city buttons (for larger screens)
        if (cityButtons) {
            cityButtons.innerHTML = getAvailableCities().map(city => {
                const isActive = city.key === this.currentCity;
                const hasCalendar = hasCityCalendar(city.key);
                const href = hasCalendar ? `city.html?city=${city.key}` : '#';
                const extraClass = hasCalendar ? '' : ' coming-soon';
                const activeClass = isActive ? ' active' : '';
                
                return `
                    <a href="${href}" class="city-button${activeClass}${extraClass}" data-city="${city.key}">
                        <div class="city-emoji">${city.emoji}</div>
                        <div class="city-name">${city.name}</div>
                        ${!hasCalendar ? '<div style="font-size: 0.7rem; margin-top: 4px; opacity: 0.8;">Coming Soon</div>' : ''}
                    </a>
                `;
            }).join('');

            // Add click handlers for city buttons
            cityButtons.addEventListener('click', (e) => {
                const cityButton = e.target.closest('.city-button');
                if (cityButton && !cityButton.classList.contains('coming-soon')) {
                    const cityKey = cityButton.dataset.city;
                    if (cityKey && cityKey !== this.currentCity) {
                        this.navigateToCity(cityKey);
                    }
                }
            });
        }
        
        // Setup dropdown (for smaller screens)
        if (citySelect) {
            // Clear existing options except the first one
            citySelect.innerHTML = '<option value="">Select a city...</option>';
            
            // Add available cities to selector
            getAvailableCities().forEach(city => {
                const option = document.createElement('option');
                option.value = city.key;
                const hasCalendar = hasCityCalendar(city.key);
                option.textContent = `${city.emoji} ${city.name}${!hasCalendar ? ' (Coming Soon)' : ''}`;
                if (city.key === this.currentCity) {
                    option.selected = true;
                }
                if (!hasCalendar) {
                    option.disabled = true;
                }
                citySelect.appendChild(option);
            });

            // Add change event listener
            citySelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    this.navigateToCity(e.target.value);
                }
            });
        }

        // Populate available cities list for error page
        if (availableCitiesList) {
            availableCitiesList.innerHTML = getAvailableCities()
                .filter(city => hasCityCalendar(city.key))
                .map(city => `
                    <a href="city.html?city=${city.key}" class="city-link">
                        ${city.emoji} ${city.name}
                    </a>
                `).join('');
        }
    }

    // Navigate to a different city
    navigateToCity(cityKey) {
        window.location.href = `city.html?city=${cityKey}`;
    }

    // Show error when city is not found or unavailable
    showCityNotFound() {
        const cityNotFound = document.querySelector('.city-not-found');
        const cityPage = document.querySelector('.city-page');
        
        if (cityNotFound && cityPage) {
            cityNotFound.style.display = 'block';
            cityPage.style.display = 'none';
        }
        
        document.title = 'City Not Found - Chunky Dad';
        this.log('City not found, showing error page');
    }

    // Update page content with city information
    updatePageContent() {
        if (!this.currentCityConfig) return;

        const cityTitle = document.getElementById('city-title');
        const cityTagline = document.getElementById('city-tagline');
        const cityCTAText = document.getElementById('city-cta-text');
        
        if (cityTitle) {
            cityTitle.textContent = `${this.currentCityConfig.emoji} ${this.currentCityConfig.name}`;
        }
        
        if (cityTagline) {
            cityTagline.textContent = this.currentCityConfig.tagline;
        }
        
        if (cityCTAText) {
            cityCTAText.textContent = `Know about other bear events or venues in ${this.currentCityConfig.name}? Help us keep this guide current!`;
        }
        
        // Update page title
        document.title = `${this.currentCityConfig.name} Bear Guide - Chunky Dad`;
        
        this.log(`Updated page content for ${this.currentCityConfig.name}`);
    }

    // Get current city key
    getCurrentCity() {
        return this.currentCity;
    }

    // Get current city configuration
    getCurrentCityConfig() {
        return this.currentCityConfig;
    }

    // Check if current city has calendar
    hasCalendar() {
        return this.currentCityConfig && this.currentCityConfig.calendarId;
    }

    // Switch to a different city (without page reload)
    switchCity(cityKey) {
        const cityConfig = getCityConfig(cityKey);
        if (!cityConfig) {
            this.error(`City configuration not found: ${cityKey}`);
            return false;
        }

        this.currentCity = cityKey;
        this.currentCityConfig = cityConfig;
        
        // Update URL without reload
        const newUrl = `${window.location.pathname}?city=${cityKey}`;
        window.history.pushState({ city: cityKey }, '', newUrl);
        
        // Update page content
        this.updatePageContent();
        
        // Update city selector
        this.setupCitySelector();
        
        // Trigger city change event
        this.onCityChange();
        
        this.log(`Switched to ${cityConfig.name}`);
        return true;
    }

    // Callback for city changes
    onCityChange() {
        // Notify other modules of city change
        if (window.calendarManager && window.calendarManager.onCityChange) {
            window.calendarManager.onCityChange(this.currentCity, this.currentCityConfig);
        }
    }

    // Get available cities with calendar
    getAvailableCitiesWithCalendar() {
        return getAvailableCities().filter(city => hasCityCalendar(city.key));
    }

    // Validate city key
    isValidCity(cityKey) {
        return getCityConfig(cityKey) !== null;
    }

    // Check if city has calendar configured
    cityHasCalendar(cityKey) {
        return hasCityCalendar(cityKey);
    }

    // Get city display name
    getCityDisplayName(cityKey) {
        const config = getCityConfig(cityKey);
        return config ? `${config.emoji} ${config.name}` : 'Unknown City';
    }

    // Reset to default city
    resetToDefault() {
        this.currentCity = 'new-york';
        this.currentCityConfig = getCityConfig(this.currentCity);
        this.updatePageContent();
        this.setupCitySelector();
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.CitySelector = CitySelector;
}
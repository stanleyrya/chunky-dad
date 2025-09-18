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

        // Update header title based on page type
        this.updateHeaderTitle();
        
        // Add city selector to city pages
        if (this.isCityPage()) {
            this.addCitySelector();
        }

        // Apply iOS Safari visualViewport workaround for fixed header misalignment bugs
        this.applyIosHeaderWorkaround(header);
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

    // iOS Safari 18/26 beta header misalignment workaround
    applyIosHeaderWorkaround(headerEl) {
        try {
            const ua = navigator.userAgent || navigator.vendor || window.opera || '';
            const isIOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
            const vv = window.visualViewport;

            if (!isIOS || !isSafari || !vv) return;
            if (!this.isCityPage()) return; // limit scope to city pages per report

            let rafId = null;
            const adjust = () => {
                rafId && cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    // Compute header offset based on visual viewport y offset
                    const offsetY = Math.max(0, Math.round(vv.offsetTop || 0));
                    // Use transform to avoid layout thrash and preserve position: fixed
                    headerEl.style.transform = offsetY ? `translateY(${offsetY}px)` : '';
                });
            };

            // Respond to viewport changes and scroll
            vv.addEventListener('scroll', adjust);
            vv.addEventListener('resize', adjust);
            window.addEventListener('scroll', adjust, { passive: true });

            // Initial adjustment after a tick to ensure computed styles are ready
            setTimeout(adjust, 0);

            this.logger.info('HEADER', 'iOS Safari header workaround enabled');
        } catch (e) {
            this.logger.warn('HEADER', 'Failed to enable iOS header workaround', { error: e?.message });
        }
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

    addCitySelector() {
        this.logger.componentInit('HEADER', 'Adding city selector to header');
        const navContainer = document.querySelector('.nav-container');
        if (!navContainer) {
            this.logger.componentError('HEADER', 'Nav container not found');
            return;
        }

        // Create city selector container
        const citySelector = document.createElement('div');
        citySelector.className = 'city-switcher';
        
        // Create emoji button with city name for larger screens
        const emojiButton = document.createElement('button');
        emojiButton.className = 'city-switcher-btn';
        emojiButton.id = 'city-switcher-btn';
        emojiButton.setAttribute('aria-label', 'Switch city');
        
        // Add city name for larger screens
        const cityName = this.currentCity?.name || 'Switch City';
        emojiButton.innerHTML = `
            <span class="city-emoji" id="current-city-emoji">${this.currentCity?.emoji || '🏙️'}</span>
            <span class="city-name" id="current-city-name">${cityName}</span>
            <span class="city-carrot">▼</span>
        `;
        
        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'city-dropdown';
        dropdown.id = 'city-dropdown';
        
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
            this.logger.userInteraction('HEADER', 'City switcher button clicked');
            this.toggleDropdown(dropdown);
        });

        // Add fallback click handler for better compatibility
        emojiButton.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        // Add touch support for mobile devices
        emojiButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.logger.userInteraction('HEADER', 'City switcher button touched');
            this.toggleDropdown(dropdown);
        });

        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!citySelector.contains(e.target)) {
                dropdown.classList.remove('open');
                const button = document.getElementById('city-switcher-btn');
                if (button) button.classList.remove('active');
                // Reset inline styles when closing
                dropdown.style.pointerEvents = '';
                dropdown.style.visibility = '';
                dropdown.style.opacity = '';
                dropdown.style.transform = '';
            }
        };
        
        document.addEventListener('click', closeDropdown);

        // Prevent dropdown from closing when clicking inside
        dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        citySelector.appendChild(emojiButton);
        citySelector.appendChild(dropdown);
        navContainer.appendChild(citySelector);

        this.logger.componentLoad('HEADER', `City selector added to header with ${cities.length} cities`);
        this.logger.debug('HEADER', `Dropdown element created with ID: ${dropdown.id}`);
        
        // Verify dropdown is properly positioned
        setTimeout(() => {
            this.verifyDropdownSetup(dropdown, citySelector);
        }, 100);
    }

    toggleDropdown(dropdown) {
        const isVisible = dropdown.classList.contains('open');
        const button = document.getElementById('city-switcher-btn');
        
        if (isVisible) {
            dropdown.classList.remove('open');
            if (button) button.classList.remove('active');
            this.logger.debug('HEADER', 'Dropdown closed');
            // Reset inline styles when closing
            dropdown.style.pointerEvents = '';
            dropdown.style.visibility = '';
            dropdown.style.opacity = '';
            dropdown.style.transform = '';
        } else {
            dropdown.classList.add('open');
            if (button) button.classList.add('active');
            this.logger.debug('HEADER', 'Dropdown opened');
            
            // Force dropdown to be visible and clickable
            dropdown.style.pointerEvents = 'auto';
            dropdown.style.visibility = 'visible';
            dropdown.style.opacity = '1';
            dropdown.style.transform = 'translateY(0)';
            
            // Ensure dropdown is properly positioned and not clipped
            setTimeout(() => {
                this.ensureDropdownVisibility(dropdown);
            }, 10);
        }
    }

    ensureDropdownVisibility(dropdown) {
        // Check if dropdown is visible in viewport
        const rect = dropdown.getBoundingClientRect();
        const isVisible = rect.top >= 0 && rect.left >= 0 && 
                         rect.bottom <= window.innerHeight && 
                         rect.right <= window.innerWidth;
        
        if (!isVisible) {
            this.logger.debug('HEADER', 'Dropdown may be clipped, adjusting position');
            // If dropdown is clipped, adjust position
            if (rect.bottom > window.innerHeight) {
                dropdown.style.top = 'auto';
                dropdown.style.bottom = '100%';
                dropdown.style.marginTop = '0';
                dropdown.style.marginBottom = '0.5rem';
            }
        }
    }

    verifyDropdownSetup(dropdown, citySelector) {
        const rect = dropdown.getBoundingClientRect();
        const parentRect = citySelector.getBoundingClientRect();
        
        this.logger.debug('HEADER', `Dropdown verification - Parent: ${parentRect.width}x${parentRect.height}, Dropdown: ${rect.width}x${rect.height}`);
        this.logger.debug('HEADER', `Dropdown position - Top: ${rect.top}, Left: ${rect.left}, Z-index: ${window.getComputedStyle(dropdown).zIndex}`);
        
        // Check if dropdown is properly positioned relative to parent
        if (rect.width > 0 && rect.height > 0) {
            this.logger.componentLoad('HEADER', 'Dropdown setup verified successfully');
        } else {
            this.logger.componentError('HEADER', 'Dropdown has zero dimensions - positioning issue detected');
        }
    }

    switchCity(cityKey) {
        this.logger.userInteraction('HEADER', `Switching to city: ${cityKey}`);
        
        // Use the new city subdirectory format
        // If we're already in a subdirectory, navigate relative to root
        const currentPath = window.location.pathname;
        const isInSubdirectory = currentPath.split('/').filter(Boolean).length > 0 && 
            !currentPath.includes('index.html') && 
            !currentPath.includes('city.html');
        
        const basePath = isInSubdirectory ? '../' : '';
        window.location.href = `${basePath}${cityKey}/`;
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
        this.logger.componentLoad('HEADER', `⚡ Fast header update for city: ${cityKey}`);
        this.currentCity = getCityConfig(cityKey);
        this.updateHeaderTitle();
        
        // Update emoji button if it exists
        const emojiButton = document.getElementById('city-switcher-btn');
        if (emojiButton && this.currentCity) {
            const cityName = this.currentCity.name || 'Switch City';
            emojiButton.innerHTML = `
                <span class="city-emoji" id="current-city-emoji">${this.currentCity.emoji}</span>
                <span class="city-name" id="current-city-name">${cityName}</span>
                <span class="city-carrot">▼</span>
            `;
            emojiButton.setAttribute('aria-label', `Switch city - currently ${cityName}`);
        }
    }
}

// Initialize header manager immediately when script loads
// This allows header to update as soon as possible without waiting for full DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.headerManager = new HeaderManager();
    });
} else {
    // DOM is already ready, initialize immediately
    window.headerManager = new HeaderManager();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderManager;
}
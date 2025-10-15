// Dynamic Bars Loader - Handles bars UI, Google Sheets integration, and city-specific bar management
class DynamicBarsLoader extends BarsCore {
    constructor() {
        super();
        this.currentCity = null;
        this.currentCityConfig = null;
        this.isInitialized = false;
        this.isInitializing = false;
        
        // UI state management
        this.currentView = 'list'; // 'list' or 'map'
        this.searchTerm = '';
        this.filterType = 'all';
        this.sortBy = 'name'; // 'name', 'distance', 'type'
        
        // Map integration
        this.map = null;
        this.markers = [];
        this.userLocation = null;
        
        // Form handling
        this.addBarForm = null;
        this.isSubmitting = false;
        
        logger.componentInit('BARS', 'Dynamic BarsLoader initialized');
    }

    // Initialize bars system
    async initialize(cityKey = null) {
        if (this.isInitialized || this.isInitializing) {
            logger.warn('BARS', 'Bars system already initialized or initializing');
            return;
        }

        this.isInitializing = true;
        logger.componentInit('BARS', 'Initializing bars system', { cityKey });

        try {
            // Set current city
            if (cityKey) {
                this.currentCity = cityKey;
                this.currentCityConfig = getCityConfig(cityKey);
            }

            // Set up Google Sheets configuration from environment variables
            await this.setupGoogleSheetsConfig();

            // Load bars data
            await this.loadBarsData();

            // Set up UI
            this.setupUI();

            // Set up form handling
            this.setupFormHandling();

            this.isInitialized = true;
            this.isInitializing = false;

            logger.componentLoad('BARS', 'Bars system initialized successfully', {
                cityKey: this.currentCity,
                barCount: this.allBars.length
            });

        } catch (error) {
            this.isInitializing = false;
            logger.componentError('BARS', 'Failed to initialize bars system', error);
            throw error;
        }
    }

    // Set up Google Sheets configuration from environment variables
    async setupGoogleSheetsConfig() {
        try {
            // In a real implementation, these would come from environment variables
            // For now, we'll use placeholder values that should be set via GitHub secrets
            const url = process.env.GOOGLE_APP_SCRIPT_URL || window.GOOGLE_APP_SCRIPT_URL;
            const secretKey = process.env.GOOGLE_APP_SCRIPT_KEY || window.GOOGLE_APP_SCRIPT_KEY;

            if (!url || !secretKey) {
                logger.warn('BARS', 'Google Sheets configuration not found in environment variables');
                // For development, you can set these manually
                // this.setGoogleSheetsConfig('YOUR_APP_SCRIPT_URL', 'YOUR_SECRET_KEY');
                return;
            }

            this.setGoogleSheetsConfig(url, secretKey);
        } catch (error) {
            logger.componentError('BARS', 'Failed to setup Google Sheets configuration', error);
            throw error;
        }
    }

    // Set up UI elements
    setupUI() {
        logger.componentInit('BARS', 'Setting up bars UI');

        // Create bars container if it doesn't exist
        this.createBarsContainer();

        // Set up view controls
        this.setupViewControls();

        // Set up search and filters
        this.setupSearchAndFilters();

        // Set up map integration
        this.setupMapIntegration();

        logger.componentLoad('BARS', 'Bars UI setup complete');
    }

    // Create bars container
    createBarsContainer() {
        let container = document.getElementById('bars-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'bars-container';
            container.className = 'bars-container';
            
            // Insert after calendar container if it exists
            const calendarContainer = document.querySelector('.calendar-container');
            if (calendarContainer) {
                calendarContainer.insertAdjacentElement('afterend', container);
            } else {
                document.body.appendChild(container);
            }
        }

        this.container = container;
    }

    // Set up view controls
    setupViewControls() {
        const controlsHTML = `
            <div class="bars-controls">
                <div class="bars-view-controls">
                    <button class="view-btn active" data-view="list">📋 List</button>
                    <button class="view-btn" data-view="map">🗺️ Map</button>
                </div>
                <div class="bars-actions">
                    <button class="add-bar-btn">➕ Add Bar</button>
                    <button class="refresh-bars-btn">🔄 Refresh</button>
                </div>
            </div>
        `;

        this.container.innerHTML = controlsHTML;

        // Add event listeners
        this.container.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.target.dataset.view;
                this.switchView(view);
            });
        });

        this.container.querySelector('.add-bar-btn').addEventListener('click', () => {
            this.showAddBarForm();
        });

        this.container.querySelector('.refresh-bars-btn').addEventListener('click', () => {
            this.refreshBarsData();
        });
    }

    // Set up search and filters
    setupSearchAndFilters() {
        const searchHTML = `
            <div class="bars-search-filters">
                <div class="search-container">
                    <input type="text" id="bars-search" placeholder="Search bars..." class="bars-search-input">
                    <button class="search-btn">🔍</button>
                </div>
                <div class="filter-container">
                    <select id="bars-type-filter" class="bars-filter-select">
                        <option value="all">All Types</option>
                        <option value="bar">Bar</option>
                        <option value="club">Club</option>
                        <option value="restaurant">Restaurant</option>
                        <option value="cafe">Cafe</option>
                    </select>
                    <select id="bars-sort" class="bars-filter-select">
                        <option value="name">Sort by Name</option>
                        <option value="distance">Sort by Distance</option>
                        <option value="type">Sort by Type</option>
                    </select>
                </div>
            </div>
        `;

        this.container.insertAdjacentHTML('beforeend', searchHTML);

        // Add event listeners
        const searchInput = document.getElementById('bars-search');
        const typeFilter = document.getElementById('bars-type-filter');
        const sortSelect = document.getElementById('bars-sort');

        searchInput.addEventListener('input', (e) => {
            this.searchTerm = e.target.value;
            this.renderBars();
        });

        typeFilter.addEventListener('change', (e) => {
            this.filterType = e.target.value;
            this.renderBars();
        });

        sortSelect.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.renderBars();
        });
    }

    // Set up map integration
    setupMapIntegration() {
        // This would integrate with your existing map system
        // For now, we'll create a placeholder
        const mapHTML = `
            <div id="bars-map" class="bars-map" style="display: none;">
                <div class="map-placeholder">
                    <p>🗺️ Map view will be integrated here</p>
                    <p>Bars will be displayed as markers on the map</p>
                </div>
            </div>
        `;

        this.container.insertAdjacentHTML('beforeend', mapHTML);
    }

    // Set up form handling
    setupFormHandling() {
        // Create add bar form modal
        this.createAddBarForm();
    }

    // Create add bar form
    createAddBarForm() {
        const formHTML = `
            <div id="add-bar-modal" class="modal" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Add New Bar</h3>
                        <button class="close-btn">&times;</button>
                    </div>
                    <form id="add-bar-form" class="add-bar-form">
                        <div class="form-group">
                            <label for="bar-name">Bar Name *</label>
                            <input type="text" id="bar-name" name="name" required>
                        </div>
                        <div class="form-group">
                            <label for="bar-city">City *</label>
                            <select id="bar-city" name="city" required>
                                <option value="">Select City</option>
                                ${this.getCityOptions()}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="bar-type">Type</label>
                            <select id="bar-type" name="type">
                                <option value="bar">Bar</option>
                                <option value="club">Club</option>
                                <option value="restaurant">Restaurant</option>
                                <option value="cafe">Cafe</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="bar-address">Address</label>
                            <input type="text" id="bar-address" name="address">
                        </div>
                        <div class="form-group">
                            <label for="bar-coordinates">Coordinates (lat, lng)</label>
                            <input type="text" id="bar-coordinates" name="coordinates" placeholder="40.7831, -73.9712">
                        </div>
                        <div class="form-group">
                            <label for="bar-website">Website</label>
                            <input type="url" id="bar-website" name="website">
                        </div>
                        <div class="form-group">
                            <label for="bar-instagram">Instagram</label>
                            <input type="url" id="bar-instagram" name="instagram">
                        </div>
                        <div class="form-group">
                            <label for="bar-google-maps">Google Maps</label>
                            <input type="url" id="bar-google-maps" name="googleMaps">
                        </div>
                        <div class="form-group">
                            <label for="bar-nickname">Nickname</label>
                            <input type="text" id="bar-nickname" name="nickname">
                        </div>
                        <div class="form-group">
                            <label for="bar-hours">Hours</label>
                            <textarea id="bar-hours" name="hours" rows="3"></textarea>
                        </div>
                        <div class="form-actions">
                            <button type="submit" class="submit-btn">Add Bar</button>
                            <button type="button" class="cancel-btn">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', formHTML);

        // Add event listeners
        this.addBarForm = document.getElementById('add-bar-form');
        const modal = document.getElementById('add-bar-modal');
        const closeBtn = modal.querySelector('.close-btn');
        const cancelBtn = modal.querySelector('.cancel-btn');

        closeBtn.addEventListener('click', () => this.hideAddBarForm());
        cancelBtn.addEventListener('click', () => this.hideAddBarForm());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.hideAddBarForm();
        });

        this.addBarForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddBarForm(e);
        });
    }

    // Get city options for form
    getCityOptions() {
        const cities = getAvailableCities();
        return cities.map(city => 
            `<option value="${city.key}">${city.name}</option>`
        ).join('');
    }

    // Switch between list and map view
    switchView(view) {
        this.currentView = view;
        
        // Update button states
        this.container.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });

        // Show/hide appropriate containers
        const listContainer = this.container.querySelector('.bars-list');
        const mapContainer = this.container.querySelector('.bars-map');
        
        if (view === 'list') {
            if (listContainer) listContainer.style.display = 'block';
            if (mapContainer) mapContainer.style.display = 'none';
            this.renderBars();
        } else {
            if (listContainer) listContainer.style.display = 'none';
            if (mapContainer) mapContainer.style.display = 'block';
            this.renderMap();
        }

        logger.userInteraction('BARS', `Switched to ${view} view`);
    }

    // Render bars list
    renderBars() {
        let bars = this.allBars;

        // Filter by city if specified
        if (this.currentCity) {
            bars = this.filterBarsByCity(bars, this.currentCity);
        }

        // Apply search filter
        if (this.searchTerm) {
            bars = this.searchBars(bars, this.searchTerm);
        }

        // Apply type filter
        if (this.filterType !== 'all') {
            bars = this.filterBarsByType(bars, this.filterType);
        }

        // Sort bars
        bars = this.sortBars(bars, this.sortBy);

        // Create or update list container
        let listContainer = this.container.querySelector('.bars-list');
        if (!listContainer) {
            listContainer = document.createElement('div');
            listContainer.className = 'bars-list';
            this.container.appendChild(listContainer);
        }

        // Render bars
        if (bars.length === 0) {
            listContainer.innerHTML = '<div class="no-bars">No bars found matching your criteria.</div>';
            return;
        }

        const barsHTML = bars.map(bar => this.renderBarCard(bar)).join('');
        listContainer.innerHTML = barsHTML;

        // Add event listeners to bar cards
        this.setupBarCardListeners();

        logger.componentLoad('BARS', `Rendered ${bars.length} bars`);
    }

    // Render individual bar card
    renderBarCard(bar) {
        const linksHTML = bar.links ? bar.links.map(link => 
            `<a href="${link.url}" target="_blank" class="bar-link">${link.label}</a>`
        ).join('') : '';

        return `
            <div class="bar-card" data-bar-slug="${bar.slug}">
                <div class="bar-header">
                    <h3 class="bar-name">${bar.name}</h3>
                    ${bar.nickname ? `<span class="bar-nickname">"${bar.nickname}"</span>` : ''}
                </div>
                <div class="bar-details">
                    <div class="bar-type">${bar.type}</div>
                    ${bar.address ? `<div class="bar-address">📍 ${bar.address}</div>` : ''}
                    ${bar.hours ? `<div class="bar-hours">🕒 ${bar.hours}</div>` : ''}
                </div>
                ${linksHTML ? `<div class="bar-links">${linksHTML}</div>` : ''}
                <div class="bar-actions">
                    <button class="edit-bar-btn" data-bar-slug="${bar.slug}">✏️ Edit</button>
                    <button class="delete-bar-btn" data-bar-slug="${bar.slug}">🗑️ Delete</button>
                </div>
            </div>
        `;
    }

    // Sort bars
    sortBars(bars, sortBy) {
        return bars.sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'type':
                    return a.type.localeCompare(b.type);
                case 'distance':
                    // This would require user location
                    return 0;
                default:
                    return 0;
            }
        });
    }

    // Set up bar card event listeners
    setupBarCardListeners() {
        this.container.querySelectorAll('.edit-bar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const slug = e.target.dataset.barSlug;
                this.editBar(slug);
            });
        });

        this.container.querySelectorAll('.delete-bar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const slug = e.target.dataset.barSlug;
                this.deleteBar(slug);
            });
        });
    }

    // Show add bar form
    showAddBarForm() {
        const modal = document.getElementById('add-bar-modal');
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        
        // Pre-fill city if we have a current city
        if (this.currentCity) {
            const citySelect = document.getElementById('bar-city');
            citySelect.value = this.currentCity;
        }
    }

    // Hide add bar form
    hideAddBarForm() {
        const modal = document.getElementById('add-bar-modal');
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        this.addBarForm.reset();
    }

    // Handle add bar form submission
    async handleAddBarForm(e) {
        if (this.isSubmitting) return;
        
        this.isSubmitting = true;
        const submitBtn = this.addBarForm.querySelector('.submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';

        try {
            const formData = new FormData(this.addBarForm);
            const barData = Object.fromEntries(formData.entries());

            // Parse coordinates if provided
            if (barData.coordinates) {
                const coords = barData.coordinates.split(',').map(c => parseFloat(c.trim()));
                if (coords.length === 2 && !isNaN(coords[0]) && !isNaN(coords[1])) {
                    barData.coordinates = { lat: coords[0], lng: coords[1] };
                } else {
                    delete barData.coordinates;
                }
            }

            // Save to Google Sheets
            await this.saveBarData(barData);

            // Refresh the bars list
            await this.refreshBarsData();

            // Hide form
            this.hideAddBarForm();

            logger.userInteraction('BARS', 'Bar added successfully', { barName: barData.name });

        } catch (error) {
            logger.componentError('BARS', 'Failed to add bar', error);
            alert('Failed to add bar. Please try again.');
        } finally {
            this.isSubmitting = false;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Bar';
        }
    }

    // Edit bar
    editBar(slug) {
        const bar = this.allBars.find(b => b.slug === slug);
        if (!bar) return;

        // Pre-fill form with bar data
        Object.keys(bar).forEach(key => {
            const input = this.addBarForm.querySelector(`[name="${key}"]`);
            if (input) {
                if (key === 'coordinates' && bar.coordinates) {
                    input.value = `${bar.coordinates.lat}, ${bar.coordinates.lng}`;
                } else {
                    input.value = bar[key] || '';
                }
            }
        });

        this.showAddBarForm();
    }

    // Delete bar
    async deleteBar(slug) {
        if (!confirm('Are you sure you want to delete this bar?')) return;

        try {
            // In a real implementation, you'd call a delete API
            logger.userInteraction('BARS', 'Bar deleted', { slug });
            await this.refreshBarsData();
        } catch (error) {
            logger.componentError('BARS', 'Failed to delete bar', error);
            alert('Failed to delete bar. Please try again.');
        }
    }

    // Refresh bars data
    async refreshBarsData() {
        try {
            await this.loadBarsData();
            this.renderBars();
            logger.componentLoad('BARS', 'Bars data refreshed');
        } catch (error) {
            logger.componentError('BARS', 'Failed to refresh bars data', error);
        }
    }

    // Render map view
    renderMap() {
        // This would integrate with your existing map system
        logger.debug('BARS', 'Map view rendering (placeholder)');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DynamicBarsLoader;
} else {
    window.DynamicBarsLoader = DynamicBarsLoader;
}
                if (input) {
                    if (key === 'coordinates' && bar.coordinates) {
                        input.value = `${bar.coordinates.lat}, ${bar.coordinates.lng}`;
                    } else {
                        input.value = bar[key] || '';
                    }
                }
            });
        });

        this.showAddBarForm();
    }

    // Delete bar
    async deleteBar(slug) {
        if (!confirm('Are you sure you want to delete this bar?')) return;

        try {
            // In a real implementation, you'd call a delete API
            logger.userInteraction('BARS', 'Bar deleted', { slug });
            await this.refreshBarsData();
        } catch (error) {
            logger.componentError('BARS', 'Failed to delete bar', error);
            alert('Failed to delete bar. Please try again.');
        }
    }

    // Refresh bars data
    async refreshBarsData() {
        try {
            await this.loadBarsData();
            this.renderBars();
            logger.componentLoad('BARS', 'Bars data refreshed');
        } catch (error) {
            logger.componentError('BARS', 'Failed to refresh bars data', error);
        }
    }

    // Render map view
    renderMap() {
        // This would integrate with your existing map system
        logger.debug('BARS', 'Map view rendering (placeholder)');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DynamicBarsLoader;
} else {
    window.DynamicBarsLoader = DynamicBarsLoader;
}

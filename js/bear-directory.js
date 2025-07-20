// Bear Directory Module - Loads and displays bear-owned businesses and artists from Google Sheets
class BearDirectory {
    constructor() {
        // Google Sheets configuration
        this.sheetId = '1-ttoHpM6unij08U40voVi8YLn7j8Mhld4FkRsKrzql4';
        this.sheetUrl = `https://docs.google.com/spreadsheets/d/${this.sheetId}/gviz/tq?tqx=out:json`;
        
        // Data storage
        this.bearData = [];
        this.filteredData = [];
        
        // Map instance
        this.map = null;
        this.markers = [];
        
        // UI elements
        this.elements = {
            grid: null,
            searchInput: null,
            sortSelect: null,
            filterButtons: null,
            loadingIndicator: null,
            errorMessage: null
        };
        
        // Instagram embed configuration
        this.instagramEmbedScript = null;
        
        logger.componentInit('DIRECTORY', 'BearDirectory initialized');
    }
    
    async init() {
        logger.time('DIRECTORY', 'initialization');
        
        // Get DOM elements
        this.elements.grid = document.getElementById('directoryGrid');
        this.elements.searchInput = document.getElementById('searchInput');
        this.elements.sortSelect = document.getElementById('sortSelect');
        this.elements.filterButtons = document.querySelectorAll('.filter-btn');
        this.elements.loadingIndicator = document.getElementById('loadingIndicator');
        this.elements.errorMessage = document.getElementById('errorMessage');
        
        // Initialize map
        this.initMap();
        
        // Load data from Google Sheets
        await this.loadGoogleSheetsData();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Load Instagram embed script
        this.loadInstagramEmbed();
        
        logger.timeEnd('DIRECTORY', 'initialization');
    }
    
    initMap() {
        try {
            logger.componentInit('MAP', 'Initializing directory map');
            
            // Initialize Leaflet map
            this.map = L.map('directoryMap').setView([40.7128, -74.0060], 2);
            
            // Add tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(this.map);
            
            logger.componentLoad('MAP', 'Directory map initialized');
        } catch (error) {
            logger.componentError('MAP', 'Failed to initialize map', error);
        }
    }
    
    async loadGoogleSheetsData() {
        logger.apiCall('DIRECTORY', 'Loading Google Sheets data', { sheetId: this.sheetId });
        
        try {
            const response = await fetch(this.sheetUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const text = await response.text();
            
            // Parse Google Sheets JSON response
            const jsonString = text.substring(47).slice(0, -2);
            const json = JSON.parse(jsonString);
            
            // Extract data from the response
            this.bearData = this.parseGoogleSheetsData(json);
            this.filteredData = [...this.bearData];
            
            logger.componentLoad('DIRECTORY', 'Google Sheets data loaded', { 
                totalItems: this.bearData.length 
            });
            
            // Hide loading indicator and display data
            this.elements.loadingIndicator.style.display = 'none';
            this.displayDirectory();
            this.updateMap();
            
        } catch (error) {
            logger.componentError('DIRECTORY', 'Failed to load Google Sheets data', {
                error: error.message,
                stack: error.stack,
                url: this.sheetUrl
            });
            this.showError();
        }
    }
    
    parseGoogleSheetsData(json) {
        const rows = json.table.rows;
        const data = [];
        
        // Skip header row
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const cells = row.c;
            
            // Extract data from cells
            const item = {
                name: cells[0]?.v || '',
                shop: cells[1]?.v || '',
                website: cells[2]?.v || '',
                instagram: cells[3]?.v || '',
                type: cells[4]?.v || '',
                googleMaps: cells[5]?.v || '',
                coordinates: cells[6]?.v || '',
                city: cells[7]?.v || '',
                display: cells[8]?.v || '' // New Display field
            };
            
            // Clean Instagram username - remove @ symbol and trim
            if (item.instagram) {
                item.instagram = item.instagram.replace('@', '').trim();
            }
            
            // Only add if name exists
            if (item.name) {
                data.push(item);
            }
        }
        
        logger.debug('DIRECTORY', 'Parsed Google Sheets data', { itemCount: data.length });
        return data;
    }
    
    displayDirectory() {
        logger.time('DIRECTORY', 'displayDirectory');
        
        // Clear existing content
        this.elements.grid.innerHTML = '';
        
        // Create tiles for each item
        this.filteredData.forEach(item => {
            const tile = this.createTile(item);
            this.elements.grid.appendChild(tile);
        });
        
        // Reload Instagram embeds after DOM updates
        setTimeout(() => {
            this.processInstagramEmbeds();
        }, 200);
        
        logger.timeEnd('DIRECTORY', 'displayDirectory');
        logger.componentLoad('DIRECTORY', 'Directory displayed', { 
            displayedItems: this.filteredData.length 
        });
    }
    
    createTile(item) {
        const tile = document.createElement('div');
        tile.className = 'directory-tile';
        tile.setAttribute('data-type', item.type.toLowerCase());
        tile.setAttribute('data-instagram-mode', this.instagramDisplayMode);
        
        // Determine display content based on Display field
        let displayContent = '';
        const displayType = (item.display || '').toLowerCase();
        
        // Handle display based on the Display field value
        if (displayType === 'instagram' && item.instagram) {
            // Use Instagram embedding
            displayContent = this.createInstagramContent(item);
        } else if (displayType === 'shop' && item.shop) {
            // Show shop iframe or preview
            displayContent = `
                <div class="shop-preview-container">
                    <div class="shop-preview-header">
                        <span class="shop-icon">🛍️</span>
                        <span>Shop Preview</span>
                    </div>
                    <iframe src="${item.shop}" 
                            class="shop-preview-iframe" 
                            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                            loading="lazy"
                            onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'shop-preview-error\\'>Unable to preview shop<br><a href=\\'${item.shop}\\' target=\\'_blank\\'>Visit Shop →</a></div>'">
                    </iframe>
                    <a href="${item.shop}" target="_blank" class="shop-preview-link">
                        Visit Shop →
                    </a>
                </div>`;
        } else if ((displayType === 'web' || displayType === 'website') && item.website) {
            // Show website iframe or preview
            displayContent = `
                <div class="website-preview-container">
                    <div class="website-preview-header">
                        <span class="website-icon">🌐</span>
                        <span>Website Preview</span>
                    </div>
                    <iframe src="${item.website}" 
                            class="website-preview-iframe" 
                            sandbox="allow-same-origin allow-scripts allow-popups"
                            loading="lazy"
                            onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'website-preview-error\\'>Unable to preview website<br><a href=\\'${item.website}\\' target=\\'_blank\\'>Visit Site →</a></div>'">
                    </iframe>
                    <a href="${item.website}" target="_blank" class="website-preview-link">
                        Visit Website →
                    </a>
                </div>`;
        } else if (item.instagram) {
            // Default to Instagram if available and no display type specified
            displayContent = this.createInstagramContent(item);
        } else {
            // No specific display content - show placeholder
            displayContent = `
                <div class="tile-placeholder">
                    <div class="bear-icon">🐻</div>
                </div>`;
        }
        
        // Build tile content
        tile.innerHTML = `
            ${displayContent}
            <div class="tile-content">
                <h3 class="tile-name">${item.name}</h3>
                ${item.city ? `<p class="tile-city">📍 ${item.city}</p>` : ''}
                <p class="tile-type">${this.getTypeIcon(item.type)} ${item.type}</p>
                <div class="tile-links">
                    ${item.shop ? `<a href="${item.shop}" target="_blank" rel="noopener" class="tile-link">Shop</a>` : ''}
                    ${item.website ? `<a href="${item.website}" target="_blank" rel="noopener" class="tile-link">Website</a>` : ''}
                    ${item.instagram ? `<a href="https://instagram.com/${item.instagram}" target="_blank" rel="noopener" class="tile-link">Instagram</a>` : ''}
                    ${item.googleMaps ? `<a href="${item.googleMaps}" target="_blank" rel="noopener" class="tile-link">Map</a>` : ''}
                </div>
            </div>
        `;
        
        return tile;
    }
    
    createInstagramContent(item) {
        // Create Instagram embed or placeholder
        const instagramContent = item.instagram ? 
            `<div class="instagram-embed-container" data-instagram-user="${item.instagram}">
                <div class="instagram-loading">
                    <div class="loading-spinner"></div>
                    <p>Loading @${item.instagram}</p>
                </div>
                <blockquote class="instagram-media" 
                    data-instgrm-permalink="https://www.instagram.com/${item.instagram}/" 
                    data-instgrm-version="14"
                    style="background:#FFF; border:0; border-radius:3px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin: 1px; max-width:540px; min-width:326px; padding:0; width:99.375%; width:-webkit-calc(100% - 2px); width:calc(100% - 2px);">
                    <div style="padding:16px;">
                        <a href="https://www.instagram.com/${item.instagram}/" 
                           style="background:#FFFFFF; line-height:0; padding:0 0; text-align:center; text-decoration:none; width:100%;" 
                           target="_blank">
                            View on Instagram
                        </a>
                    </div>
                </blockquote>
            </div>` :
            `<div class="tile-placeholder">
                <div class="bear-icon">🐻</div>
            </div>`;
            
        return instagramContent;
    }
    
    getTypeIcon(type) {
        const icons = {
            'art': '🎨',
            'business': '🏪',
            'food': '🍔',
            'bar': '🍺',
            'shop': '🛍️',
            'service': '💼'
        };
        return icons[type.toLowerCase()] || '🐻';
    }
    
    updateMap() {
        // Clear existing markers
        this.markers.forEach(marker => marker.remove());
        this.markers = [];
        
        // Add markers for items with coordinates
        this.filteredData.forEach(item => {
            if (item.coordinates) {
                const [lat, lng] = item.coordinates.split(',').map(coord => parseFloat(coord.trim()));
                
                if (!isNaN(lat) && !isNaN(lng)) {
                    const marker = L.marker([lat, lng])
                        .addTo(this.map)
                        .bindPopup(`
                            <div class="map-popup">
                                <h4>${item.name}</h4>
                                <p>${item.type}</p>
                                ${item.city ? `<p>📍 ${item.city}</p>` : ''}
                                ${item.instagram ? `<a href="https://instagram.com/${item.instagram}" target="_blank">Instagram</a>` : ''}
                            </div>
                        `);
                    
                    this.markers.push(marker);
                }
            }
        });
        
        // Fit map to markers if any exist
        if (this.markers.length > 0) {
            const group = new L.featureGroup(this.markers);
            this.map.fitBounds(group.getBounds().pad(0.1));
        }
        
        logger.componentLoad('MAP', 'Map markers updated', { markerCount: this.markers.length });
    }
    
    setupEventListeners() {
        // Search functionality
        this.elements.searchInput.addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });
        
        // Sort functionality
        this.elements.sortSelect.addEventListener('change', (e) => {
            this.handleSort(e.target.value);
        });
        
        // Filter buttons
        this.elements.filterButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                this.handleFilter(e.target.dataset.filter);
                
                // Update active state
                this.elements.filterButtons.forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
            });
        });
        
        logger.componentInit('DIRECTORY', 'Event listeners set up');
    }
    
    handleSearch(searchTerm) {
        logger.userInteraction('DIRECTORY', 'Search performed', { searchTerm });
        
        const term = searchTerm.toLowerCase();
        
        if (!term) {
            this.filteredData = [...this.bearData];
        } else {
            this.filteredData = this.bearData.filter(item => {
                return item.name.toLowerCase().includes(term) ||
                       item.city.toLowerCase().includes(term) ||
                       item.type.toLowerCase().includes(term) ||
                       item.instagram.toLowerCase().includes(term);
            });
        }
        
        this.displayDirectory();
        this.updateMap();
    }
    
    handleSort(sortBy) {
        logger.userInteraction('DIRECTORY', 'Sort changed', { sortBy });
        
        this.filteredData.sort((a, b) => {
            switch(sortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'city':
                    return a.city.localeCompare(b.city);
                case 'type':
                    return a.type.localeCompare(b.type);
                default:
                    return 0;
            }
        });
        
        this.displayDirectory();
    }
    
    handleFilter(filterType) {
        logger.userInteraction('DIRECTORY', 'Filter applied', { filterType });
        
        if (filterType === 'all') {
            this.filteredData = [...this.bearData];
        } else {
            this.filteredData = this.bearData.filter(item => 
                item.type.toLowerCase() === filterType
            );
        }
        
        this.displayDirectory();
        this.updateMap();
    }
    
    loadInstagramEmbed() {
        // Load Instagram embed script with retry logic
        if (!this.instagramEmbedScript) {
            this.instagramEmbedScript = document.createElement('script');
            this.instagramEmbedScript.async = true;
            this.instagramEmbedScript.defer = true;
            this.instagramEmbedScript.src = 'https://www.instagram.com/embed.js';
            
            // Add error handling with retry
            this.instagramEmbedScript.onerror = (error) => {
                logger.componentError('DIRECTORY', 'Failed to load Instagram embed script', {
                    error: error,
                    src: this.instagramEmbedScript.src
                });
                
                // Retry once after a delay
                if (!this.instagramRetried) {
                    this.instagramRetried = true;
                    setTimeout(() => {
                        logger.info('DIRECTORY', 'Retrying Instagram script load');
                        this.instagramEmbedScript = null;
                        this.loadInstagramEmbed();
                    }, 2000);
                }
            };
            
            this.instagramEmbedScript.onload = () => {
                logger.componentLoad('DIRECTORY', 'Instagram embed script loaded successfully');
                // Process embeds after script loads with multiple retries
                this.processInstagramEmbeds();
            };
            
            document.body.appendChild(this.instagramEmbedScript);
            
            logger.componentInit('DIRECTORY', 'Loading Instagram embed script');
        } else if (window.instgrm && window.instgrm.Embeds) {
            // If script already loaded, just process embeds
            this.processInstagramEmbeds();
        }
    }
    
    processInstagramEmbeds(retryCount = 0) {
        const maxRetries = 3;
        
        setTimeout(() => {
            try {
                if (window.instgrm && window.instgrm.Embeds) {
                    // Get all Instagram embed containers
                    const containers = document.querySelectorAll('.instagram-embed-container');
                    
                    // Process embeds
                    window.instgrm.Embeds.process();
                    
                    // Set up observers for each container to detect when embeds load
                    containers.forEach(container => {
                        if (container.classList.contains('loaded') || container.classList.contains('error')) {
                            return; // Skip already processed containers
                        }
                        
                        // Create observer to watch for iframe insertion
                        const observer = new MutationObserver((mutations) => {
                            const iframe = container.querySelector('iframe');
                            if (iframe) {
                                // Instagram embed loaded successfully
                                container.classList.add('loaded');
                                container.classList.remove('loading');
                                observer.disconnect();
                                
                                // Ensure loading spinner is hidden
                                const loadingEl = container.querySelector('.instagram-loading');
                                if (loadingEl) {
                                    loadingEl.style.display = 'none';
                                }
                                
                                logger.debug('DIRECTORY', `Instagram embed loaded for @${container.dataset.instagramUser}`);
                            }
                        });
                        
                        // Start observing
                        observer.observe(container, { 
                            childList: true, 
                            subtree: true 
                        });
                        
                        // Set timeout for this specific embed
                        setTimeout(() => {
                            if (!container.classList.contains('loaded') && !container.classList.contains('error')) {
                                observer.disconnect();
                                container.classList.add('error');
                                container.classList.remove('loading');
                                
                                // Hide loading spinner
                                const loadingEl = container.querySelector('.instagram-loading');
                                if (loadingEl) {
                                    loadingEl.style.display = 'none';
                                }
                                
                                const username = container.dataset.instagramUser;
                                logger.warn('DIRECTORY', `Instagram embed timeout for @${username}`);
                                
                                // Show error message
                                container.innerHTML = `
                                    <div class="instagram-error">
                                        <p>Unable to load Instagram feed</p>
                                        <a href="https://instagram.com/${username}" target="_blank">View on Instagram →</a>
                                    </div>
                                `;
                            }
                        }, 8000); // 8 second timeout per embed
                    });
                    
                    logger.componentLoad('DIRECTORY', 'Instagram embeds processing started', {
                        retryCount: retryCount,
                        embedCount: containers.length
                    });
                } else if (retryCount < maxRetries) {
                    logger.warn('DIRECTORY', `Instagram not ready, retrying (${retryCount + 1}/${maxRetries})`);
                    this.processInstagramEmbeds(retryCount + 1);
                } else {
                    logger.error('DIRECTORY', 'Instagram embeds failed to process after retries');
                    // Mark all as error and hide loading spinners
                    document.querySelectorAll('.instagram-embed-container').forEach(container => {
                        container.classList.add('error');
                        container.classList.remove('loading');
                        const loadingEl = container.querySelector('.instagram-loading');
                        if (loadingEl) {
                            loadingEl.style.display = 'none';
                        }
                    });
                }
            } catch (error) {
                logger.componentError('DIRECTORY', 'Error processing Instagram embeds', {
                    error: error.message,
                    stack: error.stack,
                    retryCount: retryCount
                });
                
                if (retryCount < maxRetries) {
                    this.processInstagramEmbeds(retryCount + 1);
                } else {
                    // Mark all as error and hide loading spinners
                    document.querySelectorAll('.instagram-embed-container').forEach(container => {
                        container.classList.add('error');
                        container.classList.remove('loading');
                        const loadingEl = container.querySelector('.instagram-loading');
                        if (loadingEl) {
                            loadingEl.style.display = 'none';
                        }
                    });
                }
            }
        }, 500 * (retryCount + 1)); // Exponential backoff
    }
    
    showError() {
        this.elements.loadingIndicator.style.display = 'none';
        this.elements.errorMessage.style.display = 'block';
        
        logger.componentError('DIRECTORY', 'Error state displayed');
    }
}

// Initialize when DOM is ready
if (typeof window.bearDirectory === 'undefined') {
    window.bearDirectory = new BearDirectory();
}
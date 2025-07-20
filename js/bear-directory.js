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
        
        // Display mode for Instagram tiles
        this.instagramDisplayMode = 'full'; // Options: 'full', 'image', 'profile', 'compact'
        
        logger.componentInit('DIRECTORY', 'BearDirectory initialized');
    }
    
    init() {
        logger.componentInit('DIRECTORY', 'Initializing BearDirectory');
        
        // Load data
        this.loadGoogleSheetsData();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Initialize map
        this.initMap();
        
        // Load Instagram embed script
        this.loadInstagramEmbed();
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
                isRestricted: false // New field for restricted profiles
            };
            
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
        
        // Create Instagram content based on display mode
        let instagramContent = '';
        
        if (item.instagram) {
            switch (this.instagramDisplayMode) {
                case 'image':
                    // Show just recent posts as images
                    instagramContent = `
                        <div class="instagram-image-container" data-instagram-user="${item.instagram}">
                            <div class="instagram-loading">
                                <div class="loading-spinner"></div>
                                <p>Loading images...</p>
                            </div>
                            <div class="instagram-images-grid">
                                <!-- Images will be loaded via Instagram API -->
                            </div>
                            <a href="https://instagram.com/${item.instagram}" target="_blank" class="instagram-overlay">
                                <span>@${item.instagram}</span>
                            </a>
                        </div>`;
                    break;
                    
                case 'profile':
                    // Show just the profile picture
                    instagramContent = `
                        <div class="instagram-profile-container" data-instagram-user="${item.instagram}">
                            <div class="instagram-profile-image">
                                <img src="https://unavatar.io/instagram/${item.instagram}" 
                                     alt="@${item.instagram}" 
                                     onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ccircle cx=%2250%22 cy=%2250%22 r=%2240%22 fill=%22%23e1e1e1%22/%3E%3Ctext x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22%3E🐻%3C/text%3E%3C/svg%3E'">
                            </div>
                            <a href="https://instagram.com/${item.instagram}" target="_blank" class="instagram-username">
                                @${item.instagram}
                            </a>
                        </div>`;
                    break;
                    
                case 'compact':
                    // Compact view with small profile image and username
                    instagramContent = `
                        <div class="instagram-compact-container" data-instagram-user="${item.instagram}">
                            <img src="https://unavatar.io/instagram/${item.instagram}" 
                                 alt="@${item.instagram}" 
                                 class="instagram-compact-image"
                                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ccircle cx=%2250%22 cy=%2250%22 r=%2240%22 fill=%22%23e1e1e1%22/%3E%3Ctext x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2240%22%3E🐻%3C/text%3E%3C/svg%3E'">
                            <a href="https://instagram.com/${item.instagram}" target="_blank" class="instagram-compact-link">
                                <span class="instagram-icon">📷</span>
                                <span>@${item.instagram}</span>
                            </a>
                        </div>`;
                    break;
                    
                case 'full':
                default:
                    // Full Instagram embed
                    instagramContent = `
                        <div class="instagram-embed-container" data-instagram-user="${item.instagram}">
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
                        </div>`;
                    break;
            }
        } else {
            // No Instagram - show placeholder
            instagramContent = `
                <div class="tile-placeholder">
                    <div class="bear-icon">🐻</div>
                </div>`;
        }
        
        // For restricted profiles, show website content if available
        if (item.isRestricted && item.website && this.instagramDisplayMode !== 'compact') {
            instagramContent = `
                <div class="website-preview-container">
                    <div class="website-preview-header">
                        <span class="website-icon">🌐</span>
                        <span>Website Preview</span>
                    </div>
                    <iframe src="${item.website}" 
                            class="website-preview-iframe" 
                            sandbox="allow-same-origin allow-scripts"
                            loading="lazy"
                            onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'website-preview-error\\'>Unable to preview website<br><a href=\\'${item.website}\\' target=\\'_blank\\'>Visit Site →</a></div>'">
                    </iframe>
                    <a href="${item.website}" target="_blank" class="website-preview-link">
                        Visit Website →
                    </a>
                </div>`;
        }
        
        // Build tile content
        tile.innerHTML = `
            ${instagramContent}
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
        
        // Display mode buttons
        const displayModeButtons = document.querySelectorAll('.display-mode-btn');
        displayModeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                
                // Update active state
                displayModeButtons.forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                
                // Change display mode
                this.setInstagramDisplayMode(mode);
                
                logger.userInteraction('DIRECTORY', `Display mode changed to: ${mode}`);
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
        
        try {
            // Check if Instagram script is loaded
            if (window.instgrm && window.instgrm.Embeds) {
                window.instgrm.Embeds.process();
                
                // Check for restricted profiles after processing
                setTimeout(() => {
                    const containers = document.querySelectorAll('.instagram-embed-container');
                    containers.forEach(container => {
                        const iframe = container.querySelector('iframe');
                        const blockquote = container.querySelector('blockquote');
                        
                        // If no iframe was created and blockquote still exists, profile might be restricted
                        if (!iframe && blockquote) {
                            const username = container.dataset.instagramUser;
                            const tile = container.closest('.directory-tile');
                            const item = this.allItems.find(i => i.instagram === username);
                            
                            if (item && item.website) {
                                logger.info('DIRECTORY', `Instagram profile @${username} appears to be restricted, showing website preview`);
                                
                                // Mark as restricted and re-render tile
                                item.isRestricted = true;
                                const newTile = this.createTile(item);
                                tile.replaceWith(newTile);
                            } else {
                                logger.info('DIRECTORY', `Instagram profile @${username} appears to be restricted, no website available`);
                                container.classList.add('error');
                                container.innerHTML = `
                                    <div class="instagram-error">
                                        <p>This profile is private or restricted</p>
                                        <a href="https://instagram.com/${username}" target="_blank">View on Instagram →</a>
                                    </div>
                                `;
                            }
                        } else if (iframe) {
                            // Successfully loaded
                            container.classList.add('loaded');
                            
                            // This is expected for Instagram embeds
                            const styles = iframe.getAttribute('style');
                            if (styles && !styles.includes('height')) {
                                iframe.style.height = 'auto';
                                iframe.style.minHeight = '300px';
                            }
                        }
                    });
                    
                    // Handle timeout for remaining embeds
                    setTimeout(() => {
                        containers.forEach(container => {
                            if (!container.classList.contains('loaded') && !container.classList.contains('error')) {
                                const username = container.dataset.instagramUser;
                                logger.warn('DIRECTORY', `Instagram embed timeout for @${username} - may be throttled or blocked`, {
                                    retryCount,
                                    possibleReasons: [
                                        'Network issues',
                                        'Instagram API rate limiting',
                                        'Ad blocker interference',
                                        'CORS restrictions'
                                    ]
                                });
                                container.classList.add('error');
                            }
                        });
                    }, 5000);
                }, 1000);
                
                logger.componentLoad('DIRECTORY', 'Instagram embeds processed', {
                    embedCount: document.querySelectorAll('.instagram-embed-container').length
                });
            } else if (retryCount < maxRetries) {
                // Instagram not ready, retry
                logger.warn('DIRECTORY', `Instagram not ready, retrying (${retryCount + 1}/${maxRetries})`);
                setTimeout(() => this.processInstagramEmbeds(retryCount + 1), 1000);
            } else {
                logger.error('DIRECTORY', 'Instagram embeds failed to process after retries');
                // Mark all as error
                document.querySelectorAll('.instagram-embed-container').forEach(container => {
                    container.classList.add('error');
                });
            }
        } catch (error) {
            logger.componentError('DIRECTORY', 'Error processing Instagram embeds', {
                error: error.message,
                stack: error.stack
            });
            
            if (retryCount < maxRetries) {
                setTimeout(() => this.processInstagramEmbeds(retryCount + 1), 1000);
            } else {
                // Mark all as error
                document.querySelectorAll('.instagram-embed-container').forEach(container => {
                    container.classList.add('error');
                });
            }
        }
    }
    
    showError() {
        this.elements.loadingIndicator.style.display = 'none';
        this.elements.errorMessage.style.display = 'block';
        
        logger.componentError('DIRECTORY', 'Error state displayed');
    }

    // Add method to change display mode
    setInstagramDisplayMode(mode) {
        const validModes = ['full', 'image', 'profile', 'compact'];
        if (validModes.includes(mode)) {
            this.instagramDisplayMode = mode;
            logger.info('DIRECTORY', `Instagram display mode changed to: ${mode}`);
            this.displayDirectory(); // Re-render with new mode
        }
    }
}

// Initialize when DOM is ready
if (typeof window.bearDirectory === 'undefined') {
    window.bearDirectory = new BearDirectory();
}
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
        
        // Set up share button handlers
        this.setupShareButtons();
        
        logger.timeEnd('DIRECTORY', 'initialization');
    }
    
    applyTheme(map) {
        const PURPLE = "#667eea";
        const layers = map.getStyle().layers;

        for (const layer of layers) {
            const id = layer.id.toLowerCase();

            try {
                // water
                if (id.includes("water")) {
                    if (layer.type === "fill") {
                        map.setPaintProperty(layer.id, "fill-color", PURPLE);
                    }
                    if (layer.type === "line") {
                        map.setPaintProperty(layer.id, "line-color", PURPLE);
                    }
                }

                /* Other theme examples for later:
                // land
                if (id.includes("land") || id.includes("natural")) {
                    if (layer.type === "fill") {
                        map.setPaintProperty(layer.id, "fill-color", "#1b102b");
                    }
                }

                // roads
                if (id.includes("road")) {
                    if (layer.type === "line") {
                        map.setPaintProperty(layer.id, "line-color", "#3a2a55");
                        map.setPaintProperty(layer.id, "line-opacity", 0.35);
                    }
                }

                // labels
                if (id.includes("label")) {
                    if (layer.type === "symbol") {
                        map.setPaintProperty(layer.id, "text-color", "#b7a7d9");
                    }
                }
                */

            } catch (e) {}
        }
    }

    initMap() {
        try {
            logger.componentInit('MAP', 'Initializing directory map');
            
            // Initialize maplibregl map
            this.map = new maplibregl.Map({
                container: 'directoryMap',
                style: 'https://tiles.openfreemap.org/styles/liberty',
                center: [-74.0060, 40.7128],
                zoom: 2,
                renderWorldCopies: false
            });

            this.map.on('style.load', () => {
                this.applyTheme(this.map);
            });
            
            this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
            
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
        // Set up share button handlers for new tiles
        this.setupShareButtons();
        
        logger.timeEnd('DIRECTORY', 'displayDirectory');
        logger.componentLoad('DIRECTORY', 'Directory displayed', { 
            displayedItems: this.filteredData.length 
        });
    }

    createTile(item) {
        const tile = document.createElement('div');
        tile.className = 'directory-tile';
        tile.setAttribute('data-type', (item.type || '').toLowerCase());
        
        // Generate a consistent gradient based on the item name
        const gradients = [
            'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)',
            'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
            'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
            'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
            'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
            'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)'
        ];
        
        let hash = 0;
        const nameToHash = item.name || 'default';
        for (let i = 0; i < nameToHash.length; i++) {
            hash = nameToHash.charCodeAt(i) + ((hash << 5) - hash);
        }
        const gradientIndex = Math.abs(hash) % gradients.length;
        const gradient = gradients[gradientIndex];

        const typeIcon = this.getTypeIcon(item.type || '');
        const displayType = (item.type || '').charAt(0).toUpperCase() + (item.type || '').slice(1);
        
        tile.innerHTML = `
            <div class="tile-banner" style="background: ${gradient};">
                <div class="tile-avatar">${typeIcon}</div>
            </div>
            <div class="tile-content">
                <h3 class="tile-name">${item.name}</h3>
                ${item.city ? `<p class="tile-city">📍 ${item.city}</p>` : ''}
                <div class="tile-badges">
                    <span class="tile-badge">${typeIcon} ${displayType}</span>
                </div>
                <div class="tile-links">
                    ${item.shop ? `<a href="${item.shop}" target="_blank" rel="noopener" class="tile-link icon-only" title="Visit Shop" aria-label="Visit Shop"><i class="bi bi-bag"></i></a>` : ''}
                    ${item.website ? `<a href="${item.website}" target="_blank" rel="noopener" class="tile-link icon-only" title="Visit Website" aria-label="Visit Website"><i class="bi bi-globe"></i></a>` : ''}
                    ${item.instagram ? `<a href="https://instagram.com/${item.instagram}" target="_blank" rel="noopener" class="tile-link icon-only" title="View Instagram" aria-label="View Instagram"><i class="bi bi-instagram"></i></a>` : ''}
                    ${item.googleMaps ? `<a href="${item.googleMaps}" target="_blank" rel="noopener" class="tile-link icon-only" title="View on Map" aria-label="View on Map"><i class="bi bi-geo-alt"></i></a>` : ''}
                    <button class="share-event-btn icon-only tile-link" data-item-name="${item.name}" data-item-type="${item.type}" data-item-city="${item.city}" data-item-instagram="${item.instagram || ''}" title="Share this business" aria-label="Share this business">
                        <i class="bi bi-box-arrow-up"></i>
                    </button>
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
        const logoPath = window.pathUtils ? window.pathUtils.getLogoPath() : 'Rising_Star_Ryan_Head_Compressed.png';
        return icons[type.toLowerCase()] || `<img src="${logoPath}" alt="chunky.dad" class="bear-directory-icon">`;
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
                    const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
                        <div class="map-popup">
                            <h4>${item.name}</h4>
                            <p>${item.type}</p>
                            ${item.city ? `<p>📍 ${item.city}</p>` : ''}
                            ${item.instagram ? `<a href="https://instagram.com/${item.instagram}" target="_blank">Instagram</a>` : ''}
                        </div>
                    `);

                    const marker = new maplibregl.Marker()
                        .setLngLat([lng, lat])
                        .setPopup(popup)
                        .addTo(this.map);
                    
                    this.markers.push(marker);
                }
            }
        });
        
        // Fit map to markers if any exist
        if (this.markers.length > 0) {
            const bounds = new maplibregl.LngLatBounds();
            this.markers.forEach(marker => {
                bounds.extend(marker.getLngLat());
            });
            this.map.fitBounds(bounds, { padding: 50 });
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
        
        this.updateDisplayVisibility();
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
        
        this.updateDisplayOrder();
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
        
        this.updateDisplayVisibility();
        this.updateMap();
    }
    
    


    
    handleIframeLoad(iframe) {
        // Hide loading spinner when iframe loads successfully
        const wrapper = iframe.closest('.iframe-wrapper');
        if (wrapper) {
            const loadingEl = wrapper.querySelector('.iframe-loading');
            if (loadingEl) {
                loadingEl.style.display = 'none';
            }
        }
        
        // Check if iframe actually loaded content
        try {
            // Try to access iframe content to verify it loaded
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc || iframeDoc.body.innerHTML.length === 0) {
                // Empty iframe, treat as error
                this.handleIframeError(iframe, iframe.closest('.shop-preview-container') ? 'shop' : 'website');
            } else {
                logger.debug('DIRECTORY', 'Iframe loaded successfully', { 
                    src: iframe.src 
                });
            }
        } catch (e) {
            // Cross-origin error - iframe loaded but we can't access it
            // This is actually OK - the iframe is showing content
            logger.debug('DIRECTORY', 'Iframe loaded (cross-origin)', { 
                src: iframe.src 
            });
        }
    }
    


    


    
    updateDisplayVisibility() {
        logger.time('DIRECTORY', 'updateDisplayVisibility');
        
        // Get all existing tiles
        const tiles = this.elements.grid.querySelectorAll('.directory-tile');
        
        // Create a set of filtered item names for quick lookup
        const filteredNames = new Set(this.filteredData.map(item => item.name));
        
        // Show/hide tiles based on filtered data
        tiles.forEach(tile => {
            const tileName = tile.querySelector('.tile-name')?.textContent;
            if (filteredNames.has(tileName)) {
                tile.style.display = 'block';
            } else {
                tile.style.display = 'none';
            }
        });
        
        logger.timeEnd('DIRECTORY', 'updateDisplayVisibility');
        logger.componentLoad('DIRECTORY', 'Display visibility updated', { 
            visibleItems: this.filteredData.length 
        });
    }
    
    updateDisplayOrder() {
        logger.time('DIRECTORY', 'updateDisplayOrder');
        
        // Get all existing tiles
        const tiles = Array.from(this.elements.grid.querySelectorAll('.directory-tile'));
        
        // Create a map of tile names to DOM elements
        const tileMap = new Map();
        tiles.forEach(tile => {
            const tileName = tile.querySelector('.tile-name')?.textContent;
            if (tileName) {
                tileMap.set(tileName, tile);
            }
        });
        
        // Reorder tiles based on filtered data order
        this.filteredData.forEach(item => {
            const tile = tileMap.get(item.name);
            if (tile) {
                this.elements.grid.appendChild(tile);
            }
        });
        
        logger.timeEnd('DIRECTORY', 'updateDisplayOrder');
        logger.componentLoad('DIRECTORY', 'Display order updated');
    }

    setupShareButtons() {
        const shareButtons = document.querySelectorAll('.share-event-btn');
        
        shareButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent tile click
                
                const itemName = button.dataset.itemName;
                const itemType = button.dataset.itemType;
                const itemCity = button.dataset.itemCity;
                const itemInstagram = button.dataset.itemInstagram;
                
                // Find the tile this button belongs to
                const tile = button.closest('.directory-tile');
                if (!tile) return;
                
                // Determine what content is being displayed and get the appropriate URL
                let shareUrl = '';
                let shareText = '';
                
                if (itemInstagram) {
                    shareUrl = `https://instagram.com/${itemInstagram}`;
                    shareText = `Check out ${itemName} on Instagram`;
                }
                // Fallback to any available link
                else {
                    const anyLink = tile.querySelector('.tile-link[href*="http"]');
                    if (anyLink) {
                        shareUrl = anyLink.href;
                        shareText = `Check out ${itemName}'s website or shop`;
                    } else {
                        // Create a link to the current page with a hash if nothing else exists
                        shareUrl = window.location.href;
                        shareText = `Check out ${itemName}`;
                    }
                }
                
                logger.userInteraction('DIRECTORY', 'Share button clicked', {
                    itemName,
                    itemType,
                    shareUrl
                });
                
                // Use Web Share API if available, otherwise copy to clipboard
                if (navigator.share) {
                    try {
                        await navigator.share({
                            title: itemName,
                            text: shareText,
                            url: shareUrl
                        });
                        logger.info('DIRECTORY', 'Content shared successfully', {
                            itemName,
                            shareUrl
                        });
                    } catch (err) {
                        if (err.name !== 'AbortError') {
                            logger.error('DIRECTORY', 'Share failed', err);
                        }
                    }
                } else if (navigator.clipboard && navigator.clipboard.writeText) {
                    // Simple clipboard copy
                    try {
                        await navigator.clipboard.writeText(shareUrl);
                        logger.info('DIRECTORY', 'Content URL copied to clipboard');
                    } catch (err) {
                        logger.error('DIRECTORY', 'Copy failed', err);
                    }
                } else {
                    logger.warn('DIRECTORY', 'No share method available');
                }
            });
        });
        
        logger.debug('DIRECTORY', `Set up ${shareButtons.length} share button handlers`);
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
// Map Manager Module - Handles map initialization and event location management
class MapManager {
    constructor() {
        this.debugMode = true;
        this.currentMap = null;
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[MapManager] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[MapManager ERROR] ${message}`, data || '');
    }

    // Initialize map with events
    initializeMap(cityConfig, events) {
        const mapContainer = document.querySelector('#events-map');
        if (!mapContainer || typeof L === 'undefined') {
            this.error('Map container not found or Leaflet not loaded');
            return;
        }

        try {
            // Remove existing map if it exists
            if (this.currentMap) {
                this.currentMap.remove();
                this.currentMap = null;
            }

            // Calculate map settings
            const mapSettings = this.calculateMapSettings(cityConfig, events);
            
            // Create map
            this.currentMap = L.map('events-map', {
                scrollWheelZoom: false,
                doubleClickZoom: true,
                touchZoom: true,
                dragging: true,
                zoomControl: true
            }).setView(mapSettings.center, mapSettings.zoom);

            // Add tile layer
            this.addTileLayer(this.currentMap);
            
            // Add map controls
            this.addMapControls(this.currentMap);
            
            // Add event markers
            const markersAdded = this.addEventMarkers(this.currentMap, events);
            
            this.log(`Map initialized with ${markersAdded} markers for ${cityConfig.name}`);
            
            // Store reference globally for other functions
            window.eventsMap = this.currentMap;
            
        } catch (error) {
            this.error('Failed to initialize map:', error);
        }
    }

    // Calculate optimal map center and zoom
    calculateMapSettings(cityConfig, events) {
        const eventsWithCoords = events.filter(event => 
            event.coordinates?.lat && event.coordinates?.lng && 
            !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)
        );

        let mapCenter, mapZoom;
        
        if (eventsWithCoords.length === 0) {
            // Fallback to city config if no events have coordinates
            mapCenter = [cityConfig.coordinates.lat, cityConfig.coordinates.lng];
            mapZoom = cityConfig.mapZoom;
        } else if (eventsWithCoords.length === 1) {
            // Single event - center on it with moderate zoom
            mapCenter = [eventsWithCoords[0].coordinates.lat, eventsWithCoords[0].coordinates.lng];
            mapZoom = 12;
        } else {
            // Multiple events - calculate bounding box
            const lats = eventsWithCoords.map(e => e.coordinates.lat);
            const lngs = eventsWithCoords.map(e => e.coordinates.lng);
            
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const minLng = Math.min(...lngs);
            const maxLng = Math.max(...lngs);
            
            // Calculate center point
            mapCenter = [
                (minLat + maxLat) / 2,
                (minLng + maxLng) / 2
            ];
            
            // Calculate zoom level based on bounding box size with padding
            const latDiff = maxLat - minLat;
            const lngDiff = maxLng - minLng;
            const maxDiff = Math.max(latDiff, lngDiff);
            
            // Add padding factor to ensure events aren't at map edges
            const paddedDiff = maxDiff * 1.3;
            
            // Determine zoom level based on coordinate spread
            if (paddedDiff > 0.5) mapZoom = 8;
            else if (paddedDiff > 0.2) mapZoom = 9;
            else if (paddedDiff > 0.1) mapZoom = 10;
            else if (paddedDiff > 0.05) mapZoom = 11;
            else if (paddedDiff > 0.02) mapZoom = 12;
            else mapZoom = 13;
        }

        return { center: mapCenter, zoom: mapZoom };
    }

    // Add tile layer to map
    addTileLayer(map) {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(map);
    }

    // Add map controls and interaction notice
    addMapControls(map) {
        // Add map interaction notice
        const notice = L.control({position: 'bottomleft'});
        notice.onAdd = function() {
            const div = L.DomUtil.create('div', 'map-interaction-notice');
            div.innerHTML = '🖱️ Use Ctrl+Scroll to zoom';
            div.style.cssText = `
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 12px;
                font-family: 'Poppins', sans-serif;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.2);
            `;
            return div;
        };
        notice.addTo(map);

        // Enable scroll wheel zoom only when Ctrl is pressed
        map.on('wheel', function(e) {
            if (e.originalEvent.ctrlKey) {
                map.scrollWheelZoom.enable();
            } else {
                map.scrollWheelZoom.disable();
            }
        });

        // Disable scroll wheel zoom when mouse leaves map
        map.on('mouseout', function() {
            map.scrollWheelZoom.disable();
        });
    }

    // Add event markers to map
    addEventMarkers(map, events) {
        let markersAdded = 0;
        
        // Create custom marker icon
        const customIcon = L.divIcon({
            className: 'custom-marker',
            html: `
                <div class="marker-pin">
                    <div class="marker-icon">🐻</div>
                </div>
            `,
            iconSize: [40, 50],
            iconAnchor: [20, 50],
            popupAnchor: [0, -50]
        });

        events.forEach(event => {
            if (event.coordinates?.lat && event.coordinates?.lng && 
                !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)) {
                
                const popupContent = this.createPopupContent(event);
                
                const marker = L.marker([event.coordinates.lat, event.coordinates.lng], {
                    icon: customIcon
                })
                    .addTo(map)
                    .bindPopup(popupContent);
                
                markersAdded++;
            }
        });

        return markersAdded;
    }

    // Create popup content for event marker
    createPopupContent(event) {
        return `
            <div class="map-popup">
                <h4>${event.name}</h4>
                <p><strong>📍 ${event.bar}</strong></p>
                <p>📅 ${event.day} ${event.time}</p>
                <p>💰 ${event.cover}</p>
                ${event.recurring ? `<p>🔄 ${event.eventType}</p>` : ''}
                ${event.tea ? `<p class="popup-tea">ℹ️ ${event.tea}</p>` : ''}
            </div>
        `;
    }

    // Show specific location on map
    showLocationOnMap(lat, lng, eventName, barName) {
        if (!this.currentMap) {
            this.error('Map not initialized');
            return;
        }

        try {
            // Center map on location
            this.currentMap.setView([lat, lng], 15);
            
            // Find and open popup for this location
            this.currentMap.eachLayer(layer => {
                if (layer instanceof L.Marker) {
                    const markerLatLng = layer.getLatLng();
                    if (Math.abs(markerLatLng.lat - lat) < 0.001 && 
                        Math.abs(markerLatLng.lng - lng) < 0.001) {
                        layer.openPopup();
                    }
                }
            });
            
            // Scroll to map
            const mapElement = document.getElementById('events-map');
            if (mapElement) {
                mapElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            this.log(`Showing location: ${eventName} at ${barName}`);
            
        } catch (error) {
            this.error('Failed to show location on map:', error);
        }
    }

    // Update map with new events
    updateMap(cityConfig, events) {
        if (!this.currentMap) {
            this.initializeMap(cityConfig, events);
            return;
        }

        try {
            // Clear existing markers
            this.currentMap.eachLayer(layer => {
                if (layer instanceof L.Marker) {
                    this.currentMap.removeLayer(layer);
                }
            });

            // Add new markers
            const markersAdded = this.addEventMarkers(this.currentMap, events);
            
            // Optionally recalculate bounds if events changed significantly
            const settings = this.calculateMapSettings(cityConfig, events);
            this.currentMap.setView(settings.center, settings.zoom);
            
            this.log(`Updated map with ${markersAdded} markers`);
            
        } catch (error) {
            this.error('Failed to update map:', error);
        }
    }

    // Clean up map resources
    cleanup() {
        if (this.currentMap) {
            this.currentMap.remove();
            this.currentMap = null;
            window.eventsMap = null;
            this.log('Map cleanup completed');
        }
    }
}

// Global function for backward compatibility
function showOnMap(lat, lng, eventName, barName) {
    if (window.mapManager) {
        window.mapManager.showLocationOnMap(lat, lng, eventName, barName);
    } else {
        console.error('Map manager not initialized');
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.MapManager = MapManager;
    window.showOnMap = showOnMap; // Make globally accessible for inline onclick handlers
}
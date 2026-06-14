class HomeMap {
    constructor() {
        this.map = null;
        this.markers = [];
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

                // text
                if (layer.type === "symbol") {
                    if (map.getPaintProperty(layer.id, "text-color")) {
                        map.setPaintProperty(layer.id, "text-color", "#b7a7d9");
                    }
                }
                */
            } catch (e) {
                // Ignore layers that don't support the property
            }
        }
    }

    init() {
        try {
            logger.componentInit('MAP', 'Initializing home cities map');

            // Initialize maplibregl map
            this.map = new maplibregl.Map({
                container: 'homeMap',
                style: 'https://tiles.openfreemap.org/styles/liberty',
                center: [-74.0060, 40.7128],
                zoom: 2,
                renderWorldCopies: false
            });

            this.map.on('style.load', () => {
                this.applyTheme(this.map);
                this.updateMap();
            });

            this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

            logger.componentLoad('MAP', 'Home map initialized');
        } catch (error) {
            logger.componentError('MAP', 'Failed to initialize home map', error);
        }
    }

    updateMap() {
        // Clear existing markers
        this.markers.forEach(marker => marker.remove());
        this.markers = [];

        const cities = window.getAvailableCities ? window.getAvailableCities() : [];

        // Add markers for cities with coordinates
        cities.forEach(city => {
            if (city.coordinates && city.coordinates.lat && city.coordinates.lng) {
                const lat = city.coordinates.lat;
                const lng = city.coordinates.lng;

                if (!isNaN(lat) && !isNaN(lng)) {
                    const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
                        <div class="map-popup" style="text-align: center;">
                            <a href="${city.key}/" style="display: inline-block; color: var(--text-primary); text-decoration: none;">
                                <h4 style="margin: 5px 0; font-size: 18px;">${city.emoji} ${city.name}</h4>
                            </a>
                        </div>
                    `);

                    const el = document.createElement('div');
                    el.className = 'favicon-marker text-marker';
                    el.innerHTML = `
                        <div class="favicon-marker-container text-marker">
                            <span class="marker-text" style="font-size: 20px; line-height: 1;">${city.emoji}</span>
                        </div>
                    `;

                    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                        .setLngLat([lng, lat])
                        .setPopup(popup)
                        .addTo(this.map);
                    marker.cityName = city.name.toLowerCase();

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

        logger.componentLoad('MAP', 'Home map markers updated', { markerCount: this.markers.length });
    }

    filterMarkers(searchTerm) {
        if (!this.markers) return;

        this.markers.forEach(marker => {
            if (!searchTerm || marker.cityName.includes(searchTerm)) {
                marker.getElement().style.display = 'block';
            } else {
                marker.getElement().style.display = 'none';
            }
        });
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HomeMap;
} else {
    window.HomeMap = HomeMap;
}

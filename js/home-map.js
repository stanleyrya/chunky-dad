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
                            <h4 style="margin-bottom: 5px; color: var(--text-primary);">${city.emoji} ${city.name}</h4>
                            <p style="margin-top: 5px; margin-bottom: 10px;">${city.tagline}</p>
                            <a href="${city.key}/" style="display: inline-block; padding: 5px 10px; background-color: var(--primary-color); color: white; text-decoration: none; border-radius: 5px; font-size: 14px;">View City</a>
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

        logger.componentLoad('MAP', 'Home map markers updated', { markerCount: this.markers.length });
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HomeMap;
} else {
    window.HomeMap = HomeMap;
}

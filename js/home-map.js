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
            this.collapseAttribution();

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
                    const el = document.createElement('div');
                    el.className = 'favicon-marker text-marker';
                    el.innerHTML = `
                        <div class="favicon-marker-container text-marker">
                            <span class="marker-text" style="font-size: 20px; line-height: 1;">${city.emoji}</span>
                        </div>
                    `;

                    // A pin picks its city out of the strip rather than opening a
                    // popup bubble over the map (or jumping straight off the
                    // page): the tile lights up and scrolls into view, and the
                    // tile itself is still the way in.
                    el.style.cursor = 'pointer';
                    el.addEventListener('click', (event) => {
                        event.stopPropagation();
                        // First tap names the city — the tile lights up and
                        // scrolls into view. Second tap on the SAME pin means
                        // the answer has already been given, so it goes there.
                        if (this.pickedCityKey === city.key) {
                            logger.userInteraction('MAP', 'City pin tapped again, opening city', { cityKey: city.key });
                            window.location.href = `${window.location.origin}/${city.key}/`;
                            return;
                        }
                        this.selectCityCard(city.key);
                    });

                    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
                        .setLngLat([lng, lat])
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

    selectCityCard(cityKey) {
        if (!cityKey) return;
        document.querySelectorAll('.city-compact-card.pin-picked')
            .forEach(card => card.classList.remove('pin-picked'));
        // Recorded BEFORE the tile lookup: a city can have a pin without a
        // tile (a quiet city is pruned from the strip), and a second tap on
        // that pin should still open the city rather than do nothing twice.
        this.pickedCityKey = cityKey;
        const card = document.querySelector(`.city-compact-card[data-city-key="${cityKey}"]`);
        if (!card) return;
        card.classList.add('pin-picked');
        if (typeof card.scrollIntoView === 'function') {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        logger.userInteraction('MAP', 'City pin selected its card', { cityKey });
    }

    // MapLibre paints its attribution expanded on first render, so the credits
    // sit open over the map until dismissed. Collapse it to the (i) button;
    // one tap still opens it.
    collapseAttribution() {
        const collapse = () => {
            const container = (this.map && typeof this.map.getContainer === 'function')
                ? this.map.getContainer() : null;
            if (!container) return;
            container.querySelectorAll('.maplibregl-ctrl-attrib').forEach(el => {
                el.classList.add('maplibregl-compact');
                el.classList.remove('maplibregl-compact-show');
                el.removeAttribute('open');
                const button = el.querySelector('.maplibregl-ctrl-attrib-button');
                if (button) button.setAttribute('aria-expanded', 'false');
            });
        };
        collapse();
        if (this.map && typeof this.map.on === 'function') {
            this.map.on('load', collapse);
            this.map.once('idle', collapse);
        }
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

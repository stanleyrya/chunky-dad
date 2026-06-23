// ============================================================================
// EVENT NORMALIZERS - PURE JAVASCRIPT DATA CLEANING
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE JavaScript data normalization
//
// 🚨 CRITICAL RESTRICTIONS - NEVER ADD THESE TO THIS FILE:
// ❌ NO environment detection (typeof importModule, typeof window)
// ❌ NO Scriptable APIs (Request, Calendar, FileManager, Alert)
// ❌ NO DOM APIs (DOMParser, document, window, fetch)
// ❌ NO HTTP requests (parsers and adapters do that)
// ❌ NO calendar operations
//
// ✅ THIS FILE SHOULD ONLY CONTAIN:
// ✅ Pure JavaScript functions that transform and clean event objects
// ✅ Location enhancement and standardisation
// ✅ Google Maps URL generation
// ✅ Field sanitisation
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class NormalizerPipeline {
    constructor(core) {
        this.core = core;
        this.normalizers = [
            new BasicDataNormalizer(),
            new LocationNormalizer()
        ];
    }

    // Allows setting core after initialization, useful when there's a circular dependency
    setCore(core) {
        this.core = core;
        for (const normalizer of this.normalizers) {
            normalizer.core = core;
        }
    }

    normalizeEvent(event) {
        if (!event) return event;
        let normalized = { ...event };
        for (const normalizer of this.normalizers) {
            normalized = normalizer.normalize(normalized);
        }
        return normalized;
    }

    normalizeEvents(events) {
        if (!Array.isArray(events)) return [];
        return events.map(event => this.normalizeEvent(event));
    }
}

class BaseNormalizer {
    constructor(core) {
        this.core = core;
    }

    normalize(event) {
        return event;
    }
}

class BasicDataNormalizer extends BaseNormalizer {
    normalize(event) {
        if (!this.core) return event;
        // Sync URL and website fields
        event = this.core.syncUrlAndWebsiteFields(event);

        // Normalize basic text fields
        return this.core.normalizeEventTextFields(event);
    }
}

class LocationNormalizer extends BaseNormalizer {
    normalize(event) {
        if (!event || !this.core) return event;

        // Ensure url/website is synced before enrichment (redundant but safe)
        event = this.core.syncUrlAndWebsiteFields(event);

        // DEBUG: Check URL field before enrichment
        const hadUrlBefore = 'url' in event;
        const urlValueBefore = event.url;

        // Extract and normalize city
        const extractedCity = this.core.extractCityFromEvent(event);
        if (extractedCity) {
            event.city = extractedCity;
        }

        // Warn when the event references a city we have no config for
        if (!event.timezone && event.city && this.core.cities && !this.core.cities[event.city]) {
            const title = event.title || 'unknown';
            this.core.warnOnce(
                `timezone:${event.city}`,
                `🚨 LocationNormalizer: No timezone config for city "${event.city}" (event: "${title}")`
            );
        }

        // Check if venue name indicates TBA/placeholder
        const isTBAVenue = event.bar && (
                          event.bar.toLowerCase().includes('tba') ||
                          event.bar.toLowerCase().includes('to be announced'));

        if (isTBAVenue) {
            console.log(`🗺️ LocationNormalizer: TBA venue "${event.bar}" detected - removing fake location data`);
            event.location = null;
            event.address = null;
            event.gmaps = '';
            return event;
        }

        // Generate Google Maps URL
        if (!event.gmaps) {
            // Try to enhance incomplete addresses with city information
            if (event.address && event.city && !this.core.isFullAddress(event.address)) {
                const enhancedAddress = this.core.enhanceAddressWithCity(event.address, event.city);
                if (enhancedAddress !== event.address) {
                    event.address = enhancedAddress;
                }
            }

            // Parse coordinates from location field
            let coordinates = null;
            if (event.location && typeof event.location === 'string' && event.location.includes(',')) {
                const [lat, lng] = event.location.split(',').map(coord => parseFloat(coord.trim()));
                if (!isNaN(lat) && !isNaN(lng)) {
                    coordinates = { lat, lng };
                }
            }

            const hasFullAddress = event.address && this.core.isFullAddress(event.address);
            const shouldPreferAddress = hasFullAddress && !event.placeId;
            const addressForMaps = (hasFullAddress || !coordinates) ? event.address : null;
            const coordinatesForMaps = shouldPreferAddress ? null : coordinates;
            const venueNameForMaps = typeof event.bar === 'string' ? event.bar.trim() : null;
            const cityNameForMaps = this.core.getPrimaryCityName(event.city);

            const urlData = {
                coordinates: coordinatesForMaps,
                placeId: event.placeId || null,
                address: addressForMaps,
                venueName: venueNameForMaps,
                cityName: cityNameForMaps
            };

            // Access static method via core constructor or global if possible
            const coreClass = this.core.constructor;
            if (coreClass && typeof coreClass.generateGoogleMapsUrl === 'function') {
                event.gmaps = coreClass.generateGoogleMapsUrl(urlData);
            }
        }

        // Clean up location data based on what we have
        if (event.address && this.core.isFullAddress(event.address)) {
            // Keep address and gmaps URL
        } else if (!event.address && event.location && event.gmaps) {
            // Keep coordinates and gmaps URL
        } else if (!event.address && event.location && !event.gmaps) {
            // No valid address or gmaps URL - keep location data anyway
        }

        // DEBUG: Check URL field after enrichment
        const hasUrlAfter = 'url' in event;
        const urlValueAfter = event.url;

        if (hadUrlBefore !== hasUrlAfter || urlValueBefore !== urlValueAfter) {
            console.error(`🗺️ LocationNormalizer: URL FIELD LOST in normalize for "${event.title}"!`);
            console.error(`🗺️ LocationNormalizer: Before: hadUrl=${hadUrlBefore}, value="${urlValueBefore}"`);
            console.error(`🗺️ LocationNormalizer: After: hasUrl=${hasUrlAfter}, value="${urlValueAfter}"`);
        }

        return event;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NormalizerPipeline, BasicDataNormalizer, LocationNormalizer };
} else if (typeof window !== 'undefined') {
    window.NormalizerPipeline = NormalizerPipeline;
    window.BasicDataNormalizer = BasicDataNormalizer;
    window.LocationNormalizer = LocationNormalizer;
} else {
    // Scriptable environment
    this.NormalizerPipeline = NormalizerPipeline;
    this.BasicDataNormalizer = BasicDataNormalizer;
    this.LocationNormalizer = LocationNormalizer;
}
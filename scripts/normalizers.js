// ============================================================================
// EVENT NORMALIZERS - PURE JAVASCRIPT DATA CLEANING
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE JavaScript data normalization
//
// 🚨 CRITICAL RESTRICTIONS - NEVER ADD THESE TO THIS FILE:
// ❌ NO environment detection (typeof importModule, typeof window)
// ❌ NO Scriptable APIs (Request, Calendar, FileManager, Alert)
// ❌ NO DOM APIs (DOMParser, document, window, fetch)
// ❌ NO HTTP requests without using the provided httpAdapter
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
            new LocationNormalizer(),
            new BarDataNormalizer(),
            new OpenStreetMapNormalizer()
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

    async normalizeEventAsync(event, httpAdapter) {
        if (!event) return event;
        let normalized = { ...event };
        for (const normalizer of this.normalizers) {
            normalized = normalizer.normalize(normalized);
            if (typeof normalizer.normalizeAsync === 'function') {
                normalized = await normalizer.normalizeAsync(normalized, httpAdapter);
            }
        }
        return normalized;
    }

    async normalizeEventsAsync(events, httpAdapter) {
        if (!Array.isArray(events)) return [];
        const normalizedEvents = [];
        for (const event of events) {
            normalizedEvents.push(await this.normalizeEventAsync(event, httpAdapter));
        }
        return normalizedEvents;
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
        event = this.syncUrlAndWebsiteFields(event);

        // Normalize basic text fields
        return this.core.normalizeEventTextFields(event);
    }

    syncUrlAndWebsiteFields(event) {
        if (!event || typeof event !== 'object') {
            return event;
        }

        const hasUrl = typeof event.url === 'string' && event.url.trim().length > 0;
        const hasWebsite = typeof event.website === 'string' && event.website.trim().length > 0;

        if (!hasWebsite && hasUrl) {
            event.website = event.url;
        }

        if (!hasUrl && hasWebsite) {
            event.url = event.website;
        }

        return event;
    }
}

class BarDataNormalizer extends BaseNormalizer {
    normalize(event) {
        if (!event || !this.core || !this.core.bars) return event;

        const cityBars = this.core.bars[event.city];
        if (!cityBars || !Array.isArray(cityBars)) return event;

        let matchedBar = null;

        const normalizeStr = str => str.replace(/[^a-z0-9]/g, '');

        // Try exact/substring match by bar name if event.bar is set
        if (typeof event.bar === 'string' && event.bar.trim().length > 0) {
            const lowerEventBar = event.bar.trim().toLowerCase();
            const normalizedEventBar = normalizeStr(lowerEventBar);

            matchedBar = cityBars.find(b => {
                if (typeof b.name !== 'string') return false;
                return normalizeStr(b.name.toLowerCase()) === normalizedEventBar;
            });
            if (!matchedBar) {
                matchedBar = cityBars.find(b => {
                    if (typeof b.name !== 'string') return false;
                    return normalizedEventBar.includes(normalizeStr(b.name.toLowerCase()));
                });
            }
            if (!matchedBar) {
                matchedBar = cityBars.find(b => {
                    if (typeof b.name !== 'string') return false;
                    return normalizeStr(b.name.toLowerCase()).includes(normalizedEventBar);
                });
            }
        }

        let titleWasVenue = false;

        // Try exact/substring match by title to see if it is venue, ONLY IF bar name didn't match
        if (!matchedBar && typeof event.title === 'string' && event.title.trim().length > 0 && event.title.length <= 50) {
            const lowerTitle = event.title.trim().toLowerCase();
            const normalizedTitle = normalizeStr(lowerTitle);

            matchedBar = cityBars.find(b => {
                if (typeof b.name !== 'string') return false;
                return normalizeStr(b.name.toLowerCase()) === normalizedTitle;
            });
            if (!matchedBar) {
                matchedBar = cityBars.find(b => {
                    if (typeof b.name !== 'string') return false;
                    const normalizedBarName = normalizeStr(b.name.toLowerCase());
                    return normalizedBarName.length > 3 && normalizedTitle.includes(normalizedBarName);
                });
            }
            if (!matchedBar) {
                matchedBar = cityBars.find(b => {
                    if (typeof b.name !== 'string') return false;
                    const normalizedBarName = normalizeStr(b.name.toLowerCase());
                    return normalizedTitle.length > 3 && normalizedBarName.includes(normalizedTitle);
                });
            }

            if (matchedBar) {
                titleWasVenue = true;
            }
        }

        // Try match by event.address or event.location if not matched yet
        if (!matchedBar && typeof event.address === 'string' && event.address.trim().length > 0) {
            const lowerAddress = event.address.trim().toLowerCase();
            matchedBar = cityBars.find(b => typeof b.address === 'string' && b.address.toLowerCase() === lowerAddress);
            if (!matchedBar) {
                matchedBar = cityBars.find(b => typeof b.address === 'string' && lowerAddress.includes(b.address.toLowerCase()));
            }
        }

        if (!matchedBar && typeof event.location === 'string' && event.location.trim().length > 0) {
            const eventLocation = event.location.trim();
            matchedBar = cityBars.find(b => typeof b.coordinates === 'string' && b.coordinates.trim() === eventLocation);
        }

        let descriptionWasVenue = false;

        if (!matchedBar && typeof event.description === 'string' && event.description.trim().length > 0 && event.description.length <= 50) {
            const lowerDesc = event.description.trim().toLowerCase();
            const normalizedDesc = normalizeStr(lowerDesc);

            matchedBar = cityBars.find(b => {
                if (typeof b.name !== 'string') return false;
                return normalizeStr(b.name.toLowerCase()) === normalizedDesc;
            });
            if (!matchedBar) {
                matchedBar = cityBars.find(b => {
                    if (typeof b.name !== 'string') return false;
                    const normalizedBarName = normalizeStr(b.name.toLowerCase());
                    return normalizedBarName.length > 3 && normalizedDesc.includes(normalizedBarName);
                });
            }
            if (!matchedBar) {
                matchedBar = cityBars.find(b => {
                    if (typeof b.name !== 'string') return false;
                    const normalizedBarName = normalizeStr(b.name.toLowerCase());
                    return normalizedDesc.length > 3 && normalizedBarName.includes(normalizedDesc);
                });
            }

            if (matchedBar) {
                descriptionWasVenue = true;
            }
        }

        if (matchedBar) {
            let modified = false;

            // Set bar name if not already set (since we matched by address/location/description/title)
            if (matchedBar.name && (!event.bar || event.bar.trim() === '' || descriptionWasVenue || titleWasVenue)) {
                if (titleWasVenue && event.bar && event.bar.trim() !== '') {
                    // Title was a venue, so swap bar name into title
                    event.title = event.bar;

                    // Since description is usually also the bar when this bug happens, let's clear it
                    if (event.description && event.bar && event.description.trim() === event.bar.trim()) {
                        delete event.description;
                    }
                }
                event.bar = matchedBar.name;
                modified = true;
            }

            // Remove description if it was just the venue name
            if (descriptionWasVenue && event.description) {
                delete event.description;
                modified = true;
            }

            // Prefer the bar's full address if missing or short in event
            if (matchedBar.address) {
                if (!event.address || event.address.length < matchedBar.address.length) {
                    event.address = matchedBar.address;
                    modified = true;
                }
            }

            // Prefer the bar's coordinates if missing in event
            if (matchedBar.coordinates && !event.location) {
                event.location = matchedBar.coordinates;
                modified = true;
            }

            // Prefer the bar's Google Maps link if missing in event
            if (matchedBar.googleMaps && !event.gmaps) {
                event.gmaps = matchedBar.googleMaps;
                modified = true;
            }

            // Prefer the bar's Instagram link if missing in event
            if (matchedBar.instagram && !event.instagram) {
                event.instagram = matchedBar.instagram;
                modified = true;
            }

            if (modified && typeof this.core.formatEventNotes === 'function') {
                event.notes = this.core.formatEventNotes(event);
            }
        }

        return event;
    }
}

class LocationNormalizer extends BaseNormalizer {
    normalize(event) {
        if (!event || !this.core) return event;

        // (Removed duplicate call to syncUrlAndWebsiteFields)

        // DEBUG: Check URL field before enrichment
        const hadUrlBefore = 'url' in event;
        const urlValueBefore = event.url;

        // Extract and normalize city
        const extractedCity = this.extractCityFromEvent(event);
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

        // Re-anchor wall-clock dates now that the city (and thus timezone) may be resolved
        this.resolveWallClockDates(event);

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
            if (event.address && event.city && !this.isFullAddress(event.address)) {
                const enhancedAddress = this.enhanceAddressWithCity(event.address, event.city);
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

            const hasFullAddress = event.address && this.isFullAddress(event.address);
            const shouldPreferAddress = hasFullAddress && !event.placeId;
            const addressForMaps = (hasFullAddress || !coordinates) ? event.address : null;
            const coordinatesForMaps = shouldPreferAddress ? null : coordinates;
            const venueNameForMaps = typeof event.bar === 'string' ? event.bar.trim() : null;
            const cityNameForMaps = this.getPrimaryCityName(event.city);

            const urlData = {
                coordinates: coordinatesForMaps,
                placeId: event.placeId || null,
                address: addressForMaps,
                venueName: venueNameForMaps,
                cityName: cityNameForMaps
            };

            event.gmaps = LocationNormalizer.generateGoogleMapsUrl(urlData);
        }

        // Clean up location data based on what we have
        if (event.address && this.isFullAddress(event.address)) {
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

    // Static method to generate iOS-compatible Google Maps URLs
    static generateGoogleMapsUrl({ coordinates, placeId, address, venueName, cityName }) {
        const lat = coordinates ? parseFloat(coordinates.lat) : null;
        const lng = coordinates ? parseFloat(coordinates.lng) : null;
        const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
        const normalizedAddress = typeof address === 'string' ? address.trim() : '';
        const hasAddress = normalizedAddress.length > 0;
        const normalizedVenue = typeof venueName === 'string' ? venueName.trim() : '';
        const hasVenue = normalizedVenue.length > 0;
        const normalizedCity = typeof cityName === 'string' ? cityName.trim() : '';
        const hasCity = normalizedCity.length > 0;
        const shouldCombineVenue = hasAddress &&
            hasVenue &&
            !normalizedAddress.toLowerCase().includes(normalizedVenue.toLowerCase());
        const addressQuery = shouldCombineVenue ? `${normalizedVenue}, ${normalizedAddress}` : normalizedAddress;
        const shouldCombineCity = hasVenue &&
            hasCity &&
            !normalizedVenue.toLowerCase().includes(normalizedCity.toLowerCase());
        const fallbackQuery = shouldCombineCity ? `${normalizedVenue}, ${normalizedCity}` :
            (hasVenue ? normalizedVenue : normalizedCity);
        const hasFallbackQuery = (hasVenue || hasCity) && fallbackQuery.length > 0;
        const encodedCoordinates = hasCoordinates ? encodeURIComponent(`${lat},${lng}`) : null;
        const encodedAddress = hasAddress ? encodeURIComponent(addressQuery) : null;
        const encodedFallbackQuery = hasFallbackQuery ? encodeURIComponent(fallbackQuery) : null;

        if (placeId && hasCoordinates) {
            return `https://www.google.com/maps/search/?api=1&query=${encodedCoordinates}&query_place_id=${placeId}`;
        } else if (placeId && hasAddress) {
            return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}&query_place_id=${placeId}`;
        } else if (hasAddress) {
            return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
        } else if (hasCoordinates) {
            return `https://www.google.com/maps/search/?api=1&query=${encodedCoordinates}`;
        } else if (encodedFallbackQuery) {
            const placeIdParam = placeId ? `&query_place_id=${placeId}` : '';
            return `https://www.google.com/maps/search/?api=1&query=${encodedFallbackQuery}${placeIdParam}`;
        }
        return null;
    }

    // Check if an address is a full address (not just a city or region)
    isFullAddress(address) {
        if (!address || typeof address !== 'string') return false;

        const cleanAddress = address.trim();
        if (cleanAddress.length < 10) return false;

        if (/^(TBA|TBD|To Be Announced|To Be Determined)$/i.test(cleanAddress)) {
            return false;
        }

        const placeholderPatterns = [
            /^(venue|location|address)?\s*(tba|tbd|pending|coming soon|announced soon)$/i,
            /^(details|info|information)?\s*(coming|to follow|tba|tbd)$/i,
            /^(will be announced|location pending|venue pending)$/i
        ];

        if (placeholderPatterns.some(pattern => pattern.test(cleanAddress))) {
            return false;
        }

        const partialAddressPatterns = [
            /^(DTLA|Downtown|Midtown|Uptown|North|South|East|West|Central)\s*,?\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}$/i,
            /^[A-Za-z\s]+\s+(District|Area|Zone|Neighborhood)\s*,?\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}$/i
        ];

        if (partialAddressPatterns.some(pattern => pattern.test(cleanAddress))) {
            return false;
        }

        const fullAddressPatterns = [
            /\d+\s+\w+.*street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|place|pl|court|ct/i,
            /\d+\s+\w+.*\s+\w+/i
        ];

        const hasAddressPattern = fullAddressPatterns.some(pattern => pattern.test(cleanAddress));
        if (!hasAddressPattern) return false;

        const cityOnlyPatterns = [
            /^(new york|nyc|los angeles|san francisco|chicago|atlanta|miami|seattle|portland|denver|las vegas|vegas|boston|philadelphia|austin|dallas|houston|phoenix|toronto|london|berlin|palm springs|sitges)$/i,
            /^[a-z\s]{3,25}$/i
        ];

        const isCityOnly = cityOnlyPatterns.some(pattern => pattern.test(cleanAddress)) &&
                          !/\d/.test(cleanAddress) &&
                          !/street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|place|pl|court|ct/i.test(cleanAddress);

        return !isCityOnly;
    }

    // Enhance address with city information if it's incomplete
    enhanceAddressWithCity(address, city) {
        if (!address || !city || !this.core || !this.core.cityMappings) {
            return address;
        }

        let cityName = '';
        for (const [patterns, mappedCity] of Object.entries(this.core.cityMappings)) {
            if (mappedCity === city) {
                const patternList = patterns.split('|');
                cityName = patternList.reduce((longest, current) =>
                    current.length > longest.length ? current : longest
                );
                break;
            }
        }

        if (!cityName) {
            return address;
        }

        const lowerAddress = address.toLowerCase();
        const lowerCityName = cityName.toLowerCase();

        const stateAbbreviations = [
            'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl',
            'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me',
            'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh',
            'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
            'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'
        ];

        if (lowerAddress.includes(lowerCityName) ||
            stateAbbreviations.some(state => lowerAddress.includes(`, ${state}`))) {
            return address;
        }

        const needsEnhancement =
            address.length < 15 ||
            !address.includes(',') ||
            /^\d+\s+[NSEW]?\.?\s*[A-Za-z\s]+$/i.test(address.trim());

        if (needsEnhancement) {
            const properCityName = cityName.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            return `${address.trim()}, ${properCityName}`;
        }

        return address;
    }

    // Resolve a primary city name for map queries from a city key
    getPrimaryCityName(cityKey) {
        if (!cityKey || !this.core || !this.core.cityMappings) {
            return '';
        }

        const normalizedKey = String(cityKey).trim();
        if (!normalizedKey || normalizedKey === 'unknown') {
            return '';
        }

        for (const [patterns, mappedCity] of Object.entries(this.core.cityMappings)) {
            if (mappedCity === normalizedKey) {
                const patternList = patterns.split('|').map(pattern => pattern.trim()).filter(Boolean);
                if (patternList.length > 0) {
                    return patternList[0];
                }
                break;
            }
        }

        return normalizedKey;
    }

    // Extract city from address string
    extractCityFromAddress(address) {
        if (!address || typeof address !== 'string' || !this.core || !this.core.cityMappings) return null;

        const lowerAddress = address.toLowerCase();

        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (regex.test(lowerAddress)) {
                    return city;
                }
            }
        }

        const addressParts = address.split(',').map(part => part.trim());

        for (const part of addressParts) {
            const cityName = part.toLowerCase();

            for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
                const patternList = patterns.split('|');
                for (const pattern of patternList) {
                    if (cityName === pattern) {
                        return city;
                    }
                    const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                    if (regex.test(cityName)) {
                        return city;
                    }
                }
            }
        }

        if (addressParts.length > 0) {
            const firstPart = addressParts[0].toLowerCase();
            const normalizedCity = this.normalizeCityName(firstPart);
            // Guard: normalizeCityName echoes unmapped input back (lowercased), so
            // without this check a bare street address ("1192 folsom st") would
            // masquerade as a city and poison timezone resolution and geocoding
            // (observed 2026-07-13). Only return candidates that map to a known
            // city; otherwise report no city found so callers fall through to the
            // next strategy.
            if (normalizedCity && (
                (this.core.cities && Object.prototype.hasOwnProperty.call(this.core.cities, normalizedCity)) ||
                Object.values(this.core.cityMappings).includes(normalizedCity)
            )) {
                return normalizedCity;
            }
        }

        return null;
    }

    // Extract city from text content
    extractCityFromText(text) {
        if (!text || typeof text !== 'string' || !this.core || !this.core.cityMappings) return null;

        const lowerText = text.toLowerCase();

        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (regex.test(lowerText)) {
                    return city;
                }
            }
        }

        return null;
    }

    // Extract city from event data or URL
    // The ai-web parser stores extracted local times as wall-clock components labeled UTC when
    // it cannot resolve a timezone at parse time (flagged via event._timezoneUnresolved).
    // Once the city is known here, convert those wall-clock values to real UTC instants.
    resolveWallClockDates(event) {
        if (!event || !event._timezoneUnresolved) return event;
        // The conversion logic lives in SharedCore.resolveWallClockDates so the
        // post-merge re-anchor pass in deduplicateEvents shares the exact same
        // behavior (merges can resolve a city AFTER this normalizer already ran).
        if (!this.core || typeof this.core.resolveWallClockDates !== 'function') return event;
        return this.core.resolveWallClockDates(event);
    }

    extractCityFromEvent(event) {
        if (event.city) {
            const normalizedCity = this.normalizeCityName(String(event.city));
            return normalizedCity;
        }

        if (!this.core || !this.core.cityMappings) return 'unknown';

        const title = String(event.title || '').toLowerCase();

        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (title.includes(pattern)) {
                    return city;
                }
            }
        }

        const venue = String(event.bar || '').toLowerCase();
        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (venue.includes(pattern)) {
                    return city;
                }
            }
        }

        if (event.venue?.address) {
            const address = event.venue.address;
            const cityFromAddress = address.city || address.localized_area_display || '';
            if (cityFromAddress) {
                return this.normalizeCityName(cityFromAddress);
            }
        }

        if (event.address) {
            const cityFromAddress = this.extractCityFromAddress(event.address);
            if (cityFromAddress) {
                return cityFromAddress;
            }
        }

        const searchText = `${event.title || event.name || ''} ${event.description || ''} ${event.bar || ''}`;
        const cityFromText = this.extractCityFromText(searchText);
        if (cityFromText) {
            return cityFromText;
        }

        return 'unknown';
    }

    // Normalize city name to lowercase, handle common variations
    normalizeCityName(cityName) {
        if (!cityName || typeof cityName !== 'string' || !this.core || !this.core.cityMappings) return null;

        const normalized = cityName.toLowerCase().trim();

        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const patternList = patterns.split('|');
            if (patternList.includes(normalized)) {
                return city;
            }
        }

        if (normalized && this.core.cities && !this.core.cities[normalized]) {
            this.core.warnOnce(`city:${normalized}`, `⚠️ LocationNormalizer: Unknown city "${normalized}" (no mapping or timezone)`);
        }
        return normalized;
    }
}


// Forward-geocode candidates farther than this from the event city's center are
// rejected: a candidate 50+ km away is a same-named street/place in another city.
const CITY_CENTER_RADIUS_KM = 50;

// Hard cap on Nominatim requests per event for the forward-geocode retry
// ladder. 4 covers the full ladder (canonical address, postal/country strip,
// directional strip, venue-name rescue); every request stays 1.1s-throttled
// and later rungs only fire after earlier ones return nothing usable. Never
// raise this without revisiting the rate-limit budget.
const MAX_GEOCODE_QUERIES_PER_EVENT = 4;

// Street-type words a trailing directional can follow ("Cheshire Bridge Rd NE").
const GEOCODE_STREET_TYPE_WORDS = 'Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Court|Ct|Parkway|Pkwy|Highway|Hwy';
// Longest alternatives first so "Northeast" matches before "North".
const GEOCODE_DIRECTIONAL_WORDS = 'Northeast|Northwest|Southeast|Southwest|North|South|East|West|NE|NW|SE|SW|N|S|E|W';
// Nominatim result kinds that are administrative areas rather than a concrete
// venue or address. A simplified/fallback query reduced to a place name (e.g.
// "Brooklyn, nyc") happily matches the admin area itself; its centroid is a
// wrong-but-plausible coordinate that wins merges downstream — worse than no
// coordinates at all (observed 2026-07-14: "325 Franklin Ave, Brooklyn, NY
// 11238, USA" stored the Brooklyn borough centroid, ~4 km from the venue).
const GEOCODE_ADMIN_AREA_TYPES = [
    'city', 'borough', 'suburb', 'neighbourhood', 'quarter', 'town', 'village',
    'state', 'county', 'municipality', 'district', 'city_district', 'postcode'
];

// A directional that FOLLOWS a street-type word and ends the address or a
// comma-separated segment ("...Cheshire Bridge Rd NE", "...Road Northeast,
// Atlanta"). Nominatim's free-text parser returns 0 results for these
// (verified live 2026-07-12). Directional PREFIXES that are part of the
// street name ("3702 N Halsted", "722 E Burnside") never match: there the
// directional precedes the name instead of following a street type.
const GEOCODE_TRAILING_DIRECTIONAL_RE = new RegExp(
    `\\b((?:${GEOCODE_STREET_TYPE_WORDS})\\.?)\\s+(?:${GEOCODE_DIRECTIONAL_WORDS})\\.?(?=\\s*(?:,|$))`,
    'gi'
);

class OpenStreetMapNormalizer extends BaseNormalizer {
    constructor(core) {
        super(core);
        this.lastRequestTime = 0;
        this.memoryCache = {}; // In-memory cache for this run
    }

    async delayForRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const minimumDelay = 1100; // 1.1 seconds (Nominatim allows 1 request per second max)

        if (timeSinceLastRequest < minimumDelay) {
            const delay = minimumDelay - timeSinceLastRequest;
            await new Promise(resolve => {
                if (typeof setTimeout !== 'undefined') {
                    setTimeout(resolve, delay);
                } else if (typeof Timer !== 'undefined') {
                    const timer = new Timer();
                    timer.timeInterval = delay;
                    timer.schedule(() => resolve());
                } else {
                    resolve();
                }
            });
        }
        this.lastRequestTime = Date.now();
    }

    async checkPersistentCache(url, httpAdapter) {
        if (!httpAdapter || typeof httpAdapter.getPageCacheConfig !== 'function' || typeof httpAdapter.readCachedPage !== 'function') {
            return null;
        }
        try {
            const config = httpAdapter.getPageCacheConfig();
            if (config && config.enabled) {
                const cached = await httpAdapter.readCachedPage(url, config);
                if (cached && cached.html) {
                    try {
                        return JSON.parse(cached.html);
                    } catch (e) {
                        return null;
                    }
                }
            }
        } catch (e) {
            // Ignore cache read errors
        }
        return null;
    }

    // Usable geocode payload: a non-empty array (forward search) or an object
    // (reverse lookup). An empty array is Nominatim's "no results" — a transient
    // bad fetch of one must never be served from the persistent cache for its
    // whole TTL (observed 2026-07-12: cached empty bodies silently skipped
    // Chicago and Provincetown venues that geocode fine live).
    isUsableGeocodeData(data) {
        if (Array.isArray(data)) return data.length > 0;
        return data !== null && data !== undefined && typeof data === 'object';
    }

    // Cache-worthiness hook handed to the adapters via options.isCacheableResponse:
    // an empty-array or unparseable Nominatim body must not be written to the disk
    // cache, and a previously cached one is treated as a miss (self-heals poisoned
    // entries from earlier runs). Adapters apply this generically; only the
    // geocode fetch path passes it, so website page caching is untouched.
    isCacheableGeocodeResponse(responseData) {
        const body = responseData && typeof responseData.html === 'string'
            ? responseData.html
            : (typeof responseData === 'string' ? responseData : null);
        if (body === null) return true; // unknown shape — leave generic caching alone
        try {
            return this.isUsableGeocodeData(JSON.parse(body));
        } catch (e) {
            return false;
        }
    }

    // Human-readable label for cache-bypass logging: the decoded q= parameter
    // when present, else the URL itself (reverse lookups have no q=).
    describeGeocodeQuery(url) {
        const match = /[?&]q=([^&]*)/.exec(String(url || ''));
        if (match) {
            try {
                return decodeURIComponent(match[1]);
            } catch (e) {
                return match[1];
            }
        }
        return String(url || '');
    }

    async fetchDataWithCacheAndRateLimit(url, options, httpAdapter) {
        // 1. Check in-memory cache (per-run: a live-fetched empty result stays
        //    here so the same address is never re-queried within one run)
        if (this.memoryCache[url]) {
            return this.memoryCache[url];
        }

        // 2. Check persistent cache. A cached empty/unusable geocode body is a
        //    poisoned entry from an earlier run — treat it as a miss and refetch.
        const persistentData = await this.checkPersistentCache(url, httpAdapter);
        if (persistentData) {
            if (this.isUsableGeocodeData(persistentData)) {
                this.memoryCache[url] = persistentData;
                return persistentData;
            }
            console.log(`🗺️ OpenStreetMapNormalizer: Ignoring cached empty geocode result for "${this.describeGeocodeQuery(url)}" — refetching`);
        }

        // 3. Not cached, so we must fetch. Delay for rate limit first.
        await this.delayForRateLimit();

        // 4. Fetch the data
        const response = await httpAdapter.fetchData(url, options);
        let data = null;

        if (typeof response === 'string') {
            data = JSON.parse(response);
        } else if (response && response.html) {
            data = JSON.parse(response.html);
        } else if (response && (Array.isArray(response) || typeof response === 'object')) {
            data = response;
        }

        // Save to in-memory cache
        if (data) {
            this.memoryCache[url] = data;
        }

        return data;
    }

    // Accept a forward-geocode result only when Nominatim's own address details
    // (city/town/village/municipality/county/suburb) or display_name mention the
    // event's city. A mismatch means the query matched a same-named street in a
    // different place entirely — worse than no coordinates at all.
    geocodeResultMatchesCity(result, city) {
        const target = String(city || '').trim().toLowerCase();
        if (!target) return true;
        const details = result && typeof result.address === 'object' && result.address ? result.address : {};
        const candidates = [
            details.city,
            details.town,
            details.village,
            details.municipality,
            details.county,
            details.suburb,
            result ? result.display_name : ''
        ];
        return candidates.some(value => typeof value === 'string' && value.toLowerCase().includes(target));
    }

    // Known city-center coordinates from the cities config (generated from
    // js/city-config.js by tools/generate-scraper-cities.js). Returns
    // { lat, lng } or null when the city is unknown or has no coordinates.
    getCityCenterCoordinates(city) {
        const key = String(city || '').trim();
        if (!key || !this.core || !this.core.cities) return null;
        const cityConfig = this.core.cities[key];
        const coords = cityConfig && cityConfig.coordinates;
        if (!coords) return null;
        const lat = Number(coords.lat);
        const lng = Number(coords.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng };
    }

    // Great-circle distance in kilometers between two lat/lon points.
    haversineDistanceKm(lat1, lon1, lat2, lon2) {
        const toRad = deg => (deg * Math.PI) / 180;
        const earthRadiusKm = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const sinLat = Math.sin(dLat / 2);
        const sinLon = Math.sin(dLon / 2);
        const a = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
        return 2 * earthRadiusKm * Math.asin(Math.sqrt(Math.min(1, a)));
    }

    // Rank forward-geocode candidates by distance to the event city's center and
    // return the nearest one inside the acceptance radius, or null. This
    // supersedes the textual city check when center coordinates are known: a
    // textual "portland" match can still be the wrong Portland — distance can't.
    pickNearestGeocodeCandidate(candidates, cityCenter, eventCity, addressLabel) {
        const ranked = [];
        (Array.isArray(candidates) ? candidates : []).forEach((candidate, index) => {
            if (!candidate) return;
            const lat = Number(candidate.lat);
            const lon = Number(candidate.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            ranked.push({
                index,
                lat: candidate.lat,
                lon: candidate.lon,
                distanceKm: this.haversineDistanceKm(lat, lon, cityCenter.lat, cityCenter.lng)
            });
        });
        if (ranked.length === 0) return null;
        ranked.sort((a, b) => a.distanceKm - b.distanceKm);
        const nearest = ranked[0];
        if (nearest.distanceKm > CITY_CENTER_RADIUS_KM) {
            console.warn(`🗺️ OpenStreetMapNormalizer: All ${ranked.length} geocode candidate${ranked.length === 1 ? '' : 's'} for "${addressLabel}" fall outside ${CITY_CENTER_RADIUS_KM} km of ${eventCity} center (nearest is ${nearest.distanceKm.toFixed(1)} km away) — ignoring coordinates`);
            return null;
        }
        if (ranked.length > 1) {
            console.log(`🗺️ OpenStreetMapNormalizer: ${ranked.length} candidates for "${addressLabel}"; picked #${nearest.index + 1} (${nearest.distanceKm.toFixed(1)} km from ${eventCity} center)`);
        }
        return nearest;
    }

    // True when a Nominatim result is an administrative area (city/borough/
    // suburb/neighbourhood...) rather than a concrete venue or address. Venue
    // matches (class=amenity, addresstype=amenity) are never admin areas.
    isAdminAreaGeocodeResult(result) {
        if (!result || typeof result !== 'object') return false;
        const resultClass = String(result.class || '').toLowerCase();
        const resultType = String(result.type || '').toLowerCase();
        if (resultClass === 'boundary' && resultType === 'administrative') return true;
        if (resultClass === 'place' && GEOCODE_ADMIN_AREA_TYPES.includes(resultType)) return true;
        return GEOCODE_ADMIN_AREA_TYPES.includes(String(result.addresstype || '').toLowerCase());
    }

    // Canonical addresses ("1192 Folsom St, San Francisco, CA 94103, USA") return
    // 0 Nominatim results while "1192 Folsom St, San Francisco" resolves — the
    // postal-code/country decoration chokes the free-text parser (verified live
    // 2026-07-14). Drops the trailing country token plus any state/zip tokens
    // before it, keeping street + city. Returns '' when the address carries no
    // country decoration (looser addresses already geocode and the ladder budget
    // is tight) or when stripping would leave a bare place token — that query
    // could only match an admin centroid, so it must never be issued.
    stripPostalCodeAndCountry(address) {
        const parts = String(address || '').split(',').map(part => part.trim()).filter(Boolean);
        if (parts.length < 2 || !/^(USA|US|United States)$/i.test(parts[parts.length - 1])) return '';
        parts.pop();
        while (parts.length > 0) {
            const tail = parts[parts.length - 1];
            const isStateZip = /^[A-Z]{2}\s+\d{5}(-\d{4})?$/.test(tail);
            const isBareZip = /^\d{5}(-\d{4})?$/.test(tail);
            const isLoneStateCode = /^[A-Z]{2}$/.test(tail);
            if (!isStateZip && !isBareZip && !isLoneStateCode) break;
            parts.pop();
        }
        if (parts.length === 0 || (parts.length === 1 && !/\d/.test(parts[0]))) return '';
        return parts.join(', ');
    }

    // Strip directionals that FOLLOW a street-type word — at the end of the
    // address or before a comma. "2069 Cheshire Bridge Rd NE" → "2069 Cheshire
    // Bridge Rd"; "…Road Northeast, Atlanta, GA" → "…Road, Atlanta, GA".
    // Directional prefixes ("3702 N Halsted", "722 E Burnside") pass through
    // unchanged (see GEOCODE_TRAILING_DIRECTIONAL_RE).
    stripTrailingDirectionals(address) {
        return String(address || '')
            .replace(GEOCODE_TRAILING_DIRECTIONAL_RE, '$1')
            .replace(/\s+,/g, ',')
            .trim();
    }

    // Forward-geocode retry ladder: deduped, ordered query strings, hard-capped
    // at MAX_GEOCODE_QUERIES_PER_EVENT. Order:
    //   1. The query exactly as built today (city-anchored when the address
    //      doesn't already contain the city).
    //   2. The address with postal-code/country decoration stripped (same
    //      anchoring) — Nominatim chokes on "…, CA 94103, USA" endings.
    //   3. The address with trailing directionals stripped (same anchoring) —
    //      Nominatim's free-text parser chokes on "Rd NE" / "Road Northeast".
    //   4. "<bar>, <city>" — venue-name lookup rescues venues OSM knows by name.
    buildGeocodeQueryVariants(address, eventCity, bar) {
        const city = typeof eventCity === 'string' ? eventCity.trim() : '';
        const anchorToCity = (text) => {
            const includesCity = city && text.toLowerCase().includes(city.toLowerCase());
            return city && !includesCity ? `${text}, ${city}` : text;
        };
        const variants = [];
        const seen = new Set();
        const push = (query) => {
            const trimmed = typeof query === 'string' ? query.trim() : '';
            if (!trimmed) return;
            const key = trimmed.toLowerCase();
            if (seen.has(key)) return; // skip variants identical to an earlier one
            seen.add(key);
            variants.push(trimmed);
        };

        const baseAddress = String(address || '').trim();
        push(anchorToCity(baseAddress));
        const postalStripped = this.stripPostalCodeAndCountry(baseAddress);
        if (postalStripped) push(anchorToCity(postalStripped));
        push(anchorToCity(this.stripTrailingDirectionals(baseAddress)));
        const barName = typeof bar === 'string' ? bar.trim() : '';
        if (barName && city) {
            push(`${barName}, ${city}`);
        }

        return variants.slice(0, MAX_GEOCODE_QUERIES_PER_EVENT);
    }

    async normalizeAsync(event, httpAdapter) {
        if (!event || !httpAdapter || typeof httpAdapter.fetchData !== 'function') return event;

        const hasAddress = typeof event.address === 'string' && event.address.trim().length > 0;
        const hasLocation = typeof event.location === 'string' && event.location.trim().length > 0 && event.location.includes(',');

        let modified = false;

        const options = {
            headers: {
                'User-Agent': 'ChunkyDadScraper/1.0 (https://github.com/chunkeydad)'
            },
            // Cache-worthiness hook honored by the adapters' fetchData: never
            // persist an empty/unparseable Nominatim body to the disk cache and
            // treat an already-cached one as a miss (see isCacheableGeocodeResponse).
            isCacheableResponse: (responseData) => this.isCacheableGeocodeResponse(responseData)
        };

        if (hasAddress && !hasLocation) {
            const address = event.address.trim();
            // Bare street strings geocode anywhere on the planet: a flyer-OCR typo like
            // "922 E. BURNSIDE" (real address: 722 E Burnside, Portland) resolved to
            // Burnside, Michigan. When the event knows its city, anchor the query to it.
            // When the city also has known center coordinates, request several
            // candidates and pick by distance to that center (textual matching alone
            // false-accepts "Portland, Michigan" for a Portland OR event); otherwise
            // fall back to rejecting results whose address details don't mention the city.
            const eventCity = typeof event.city === 'string' ? event.city.trim() : '';
            const cityCenter = this.getCityCenterCoordinates(eventCity);
            const cityValidationParam = eventCity ? '&addressdetails=1' : '';
            const resultLimit = cityCenter ? 5 : 1;

            // Retry ladder: when a query returns 0 candidates (or every candidate
            // is rejected by the distance/city checks), retry with progressively
            // simplified queries. Every attempt goes through
            // fetchDataWithCacheAndRateLimit (rate-limited AND cached) and the
            // ladder is hard-capped at MAX_GEOCODE_QUERIES_PER_EVENT requests.
            const queryVariants = this.buildGeocodeQueryVariants(address, eventCity, event.bar);
            let attempts = 0;
            let resolvedLocation = null;
            for (let i = 0; i < queryVariants.length && !resolvedLocation; i++) {
                const queryText = queryVariants[i];
                const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryText)}&limit=${resultLimit}${cityValidationParam}`;
                attempts += 1;
                try {
                    const data = await this.fetchDataWithCacheAndRateLimit(url, options, httpAdapter);
                    // Simplified/fallback queries can degrade to a bare place name and
                    // match the admin area itself — reject those centroids. The first
                    // (full-address) query keeps today's behavior: a full address that
                    // resolves to an admin boundary is a different failure mode.
                    let candidates = Array.isArray(data) ? data : [];
                    if (i > 0 && candidates.length > 0) {
                        candidates = candidates.filter(result => {
                            if (!this.isAdminAreaGeocodeResult(result)) return true;
                            const kind = result.addresstype || result.type || 'unknown';
                            console.warn(`🗺️ OpenStreetMapNormalizer: Rejected admin-area result for "${queryText}" (type=${kind}) — not a venue/address`);
                            return false;
                        });
                    }
                    if (candidates.length > 0) {
                        if (cityCenter) {
                            // Distance-ranked selection: nearest candidate within the radius wins
                            const picked = this.pickNearestGeocodeCandidate(candidates, cityCenter, eventCity, queryText);
                            if (picked) {
                                resolvedLocation = `${picked.lat}, ${picked.lon}`;
                            }
                        } else {
                            const firstResult = candidates[0];
                            if (firstResult.lat && firstResult.lon) {
                                if (eventCity && !this.geocodeResultMatchesCity(firstResult, eventCity)) {
                                    console.warn(`🗺️ OpenStreetMapNormalizer: Geocode for "${queryText}" resolved outside event city "${eventCity}" ("${firstResult.display_name || 'no display name'}") — ignoring coordinates`);
                                } else {
                                    resolvedLocation = `${firstResult.lat}, ${firstResult.lon}`;
                                }
                            }
                        }
                    } else if ((!Array.isArray(data) || data.length === 0) && i < queryVariants.length - 1) {
                        console.log(`🗺️ OpenStreetMapNormalizer: 0 geocode results for "${queryText}" — trying next variant`);
                    }
                } catch (err) {
                    console.log(`🗺️ OpenStreetMapNormalizer: Failed to geocode address "${event.address}": ${err.message}`);
                }
                if (resolvedLocation) {
                    event.location = resolvedLocation;
                    modified = true;
                    console.log(`🗺️ OpenStreetMapNormalizer: Found coordinates for address "${event.address}" -> ${event.location}`);
                    if (i > 0) {
                        console.log(`🗺️ OpenStreetMapNormalizer: Geocoded via simplified query "${queryText}"`);
                    }
                }
            }
            if (!resolvedLocation) {
                // Exact shape counted by run-log-summary's geocodeNoResults guard.
                console.warn(`🗺️ OpenStreetMapNormalizer: No geocode results for "${address}" (${eventCity || 'no city'}) after ${attempts} ${attempts === 1 ? 'query' : 'queries'} — leaving location empty`);
            }
        } else if (hasLocation && !hasAddress) {
            const parts = event.location.split(',').map(p => p.trim());
            if (parts.length === 2) {
                const lat = parseFloat(parts[0]);
                const lon = parseFloat(parts[1]);

                if (!isNaN(lat) && !isNaN(lon)) {
                    // Prefer the adapter's native reverse geocoder when it exposes
                    // one (Scriptable's Location.reverseGeocode — no network quota,
                    // no Nominatim rate-limit budget). Nominatim stays the fallback.
                    let nativeAddress = null;
                    if (typeof httpAdapter.reverseGeocode === 'function') {
                        try {
                            nativeAddress = await httpAdapter.reverseGeocode(lat, lon);
                        } catch (err) {
                            console.log(`🗺️ OpenStreetMapNormalizer: Native reverse geocode failed for "${event.location}": ${err.message}`);
                        }
                    }
                    if (typeof nativeAddress === 'string' && nativeAddress.trim().length > 0) {
                        event.address = nativeAddress.trim();
                        modified = true;
                        console.log(`🗺️ OpenStreetMapNormalizer: Found address for coordinates "${event.location}" -> ${event.address} (native reverse geocode)`);
                    } else {
                        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
                        try {
                            const data = await this.fetchDataWithCacheAndRateLimit(url, options, httpAdapter);
                            if (data && data.display_name) {
                                event.address = data.display_name;
                                modified = true;
                                console.log(`🗺️ OpenStreetMapNormalizer: Found address for coordinates "${event.location}" -> ${event.address}`);
                            }
                        } catch (err) {
                            console.log(`🗺️ OpenStreetMapNormalizer: Failed to reverse geocode location "${event.location}": ${err.message}`);
                        }
                    }
                }
            }
        }

        if (modified && this.core && typeof this.core.formatEventNotes === 'function') {
            event.notes = this.core.formatEventNotes(event);
        }

        return event;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NormalizerPipeline, BasicDataNormalizer, LocationNormalizer, BarDataNormalizer, OpenStreetMapNormalizer };
} else if (typeof window !== 'undefined') {
    window.NormalizerPipeline = NormalizerPipeline;
    window.BasicDataNormalizer = BasicDataNormalizer;
    window.LocationNormalizer = LocationNormalizer;
    window.BarDataNormalizer = BarDataNormalizer;
    window.OpenStreetMapNormalizer = OpenStreetMapNormalizer;
} else {
    // Scriptable environment
    this.NormalizerPipeline = NormalizerPipeline;
    this.BasicDataNormalizer = BasicDataNormalizer;
    this.LocationNormalizer = LocationNormalizer;
    this.BarDataNormalizer = BarDataNormalizer;
    this.OpenStreetMapNormalizer = OpenStreetMapNormalizer;
}
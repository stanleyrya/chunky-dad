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

            // Set bar name if not already set (since we matched by address/location/description)
            if (matchedBar.name && (!event.bar || event.bar.trim() === '')) {
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
            return normalizedCity;
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

    async fetchDataWithCacheAndRateLimit(url, options, httpAdapter) {
        // 1. Check in-memory cache
        if (this.memoryCache[url]) {
            return this.memoryCache[url];
        }

        // 2. Check persistent cache
        const persistentData = await this.checkPersistentCache(url, httpAdapter);
        if (persistentData) {
            this.memoryCache[url] = persistentData;
            return persistentData;
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

    async normalizeAsync(event, httpAdapter) {
        if (!event || !httpAdapter || typeof httpAdapter.fetchData !== 'function') return event;

        const hasAddress = typeof event.address === 'string' && event.address.trim().length > 0;
        const hasLocation = typeof event.location === 'string' && event.location.trim().length > 0 && event.location.includes(',');

        let modified = false;

        const options = {
            headers: {
                'User-Agent': 'ChunkyDadScraper/1.0 (https://github.com/chunkeydad)'
            }
        };

        if (hasAddress && !hasLocation) {
            const query = encodeURIComponent(event.address.trim());
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`;

            try {
                const data = await this.fetchDataWithCacheAndRateLimit(url, options, httpAdapter);
                if (Array.isArray(data) && data.length > 0) {
                    const firstResult = data[0];
                    if (firstResult.lat && firstResult.lon) {
                        event.location = `${firstResult.lat}, ${firstResult.lon}`;
                        modified = true;
                        console.log(`🗺️ OpenStreetMapNormalizer: Found coordinates for address "${event.address}" -> ${event.location}`);
                    }
                }
            } catch (err) {
                console.log(`🗺️ OpenStreetMapNormalizer: Failed to geocode address "${event.address}": ${err.message}`);
            }
        } else if (hasLocation && !hasAddress) {
            const parts = event.location.split(',').map(p => p.trim());
            if (parts.length === 2) {
                const lat = parseFloat(parts[0]);
                const lon = parseFloat(parts[1]);

                if (!isNaN(lat) && !isNaN(lon)) {
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
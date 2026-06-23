// ============================================================================
// EVENT DATA NORMALIZERS
// ============================================================================
// This file contains classes for normalizing event data.
// It is intended to be used in both Node.js, Web, and Scriptable environments.
// ============================================================================

class NormalizerPipeline {
    constructor(normalizers = []) {
        this.normalizers = normalizers;
    }

    normalize(event) {
        let currentEvent = event;
        for (const normalizer of this.normalizers) {
            currentEvent = normalizer.normalize(currentEvent);
        }
        return currentEvent;
    }
}

class BasicDataNormalizer {
    constructor(eventSchema) {
        if (!eventSchema) {
            throw new Error('BasicDataNormalizer requires eventSchema dependency');
        }
        this.eventSchema = eventSchema;
    }

    normalize(event) {
        let normalized = this.normalizeEventTextFields(event);
        normalized = this.syncUrlAndWebsiteFields(normalized);
        return normalized;
    }

    // Parse notes back into field/value pairs
    parseNotesIntoFields(notes) {
        return this.eventSchema.parseNotesIntoFields(notes);
    }

    // Normalize text fields in an event object to ensure consistent comparison
    normalizeEventTextFields(event) {
        if (!event) return event;

        // Create a copy to avoid modifying the original
        const normalizedEvent = { ...event };

        // Remove empty/whitespace-only strings so undefined/"" don't diverge
        Object.keys(normalizedEvent).forEach(key => {
            if (key.startsWith('_')) return;
            const value = normalizedEvent[key];
            if (typeof value === 'string' && value.trim() === '') {
                delete normalizedEvent[key];
            }
        });

        this.applyDescriptionOverrideIdentity(normalizedEvent);

        return normalizedEvent;
    }

    applyDescriptionOverrideIdentity(event) {
        if (!event || typeof event !== 'object') {
            return event;
        }

        const explicitOverrideUid = this.normalizeOverrideUid(event.overrideUid);
        const explicitOverrideRecurrenceId = this.normalizeOverrideRecurrenceId(event.overrideRecurrenceId);
        const hasExplicitOverrideUid = Boolean(explicitOverrideUid);
        const hasExplicitOverrideRecurrenceId = Boolean(explicitOverrideRecurrenceId);

        if (hasExplicitOverrideUid !== hasExplicitOverrideRecurrenceId) {
            throw new Error('Event override identity requires both overrideUid and overrideRecurrenceId');
        }

        let resolvedOverrideUid = explicitOverrideUid;
        let resolvedOverrideRecurrenceId = explicitOverrideRecurrenceId;

        if (!resolvedOverrideUid && !resolvedOverrideRecurrenceId) {
            const description = typeof event.description === 'string' ? event.description.trim() : '';
            if (description) {
                const descriptionFields = this.parseNotesIntoFields(description);
                const descriptionOverrideUid = this.normalizeOverrideUid(descriptionFields.overrideUid);
                const descriptionOverrideRecurrenceId = this.normalizeOverrideRecurrenceId(descriptionFields.overrideRecurrenceId);
                const hasDescriptionOverrideUid = Boolean(descriptionOverrideUid);
                const hasDescriptionOverrideRecurrenceId = Boolean(descriptionOverrideRecurrenceId);

                if (hasDescriptionOverrideUid !== hasDescriptionOverrideRecurrenceId) {
                    throw new Error('Description override identity requires both override uid and override recurrence id');
                }

                if (hasDescriptionOverrideUid && hasDescriptionOverrideRecurrenceId) {
                    resolvedOverrideUid = descriptionOverrideUid;
                    resolvedOverrideRecurrenceId = descriptionOverrideRecurrenceId;
                }
            }
        }

        if (resolvedOverrideUid && resolvedOverrideRecurrenceId) {
            event.overrideUid = resolvedOverrideUid;
            event.overrideRecurrenceId = resolvedOverrideRecurrenceId;
        }

        return event;
    }

    normalizeOverrideUid(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    normalizeOverrideRecurrenceId(value) {
        if (value === null || value === undefined) return '';
        const trimmed = String(value).trim();
        if (!trimmed) return '';

        const withTimezoneMatch = trimmed.match(/^TZID=([^:]+):(\d{8}(?:T\d{4,6}Z?)?)$/i);
        if (withTimezoneMatch) {
            const timezone = withTimezoneMatch[1].trim();
            const recurrenceValue = withTimezoneMatch[2].toUpperCase();
            if (!timezone) return '';
            return `TZID=${timezone}:${recurrenceValue}`;
        }

        const withoutTimezoneMatch = trimmed.match(/^(\d{8}(?:T\d{4,6}Z?)?)$/i);
        if (withoutTimezoneMatch) {
            return withoutTimezoneMatch[1].toUpperCase();
        }

        return '';
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

class LocationNormalizer {
    constructor(cities) {
        this.cities = cities || {};
        this.cityMappings = this.convertCitiesConfigToCityMappings(this.cities);
        this.loggedWarnings = new Set();
    }

    warnOnce(key, message) {
        if (!this.loggedWarnings) {
            this.loggedWarnings = new Set();
        }
        if (this.loggedWarnings.has(key)) {
            return;
        }
        this.loggedWarnings.add(key);
        console.warn(message);
    }

    normalize(event) {
        return this.enrichEventLocation(event);
    }

    // Convert cities config format to internal cityMappings format
    convertCitiesConfigToCityMappings(cities) {
        const cityMappings = {};

        for (const [cityKey, cityConfig] of Object.entries(cities)) {
            if (cityConfig.patterns && Array.isArray(cityConfig.patterns)) {
                // Convert array of patterns to pipe-separated string format
                const pipePatterns = cityConfig.patterns.join('|');
                cityMappings[pipePatterns] = cityKey;
            }
        }

        return cityMappings;
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
            // Best case: use coordinates with place_id for maximum compatibility
            return `https://www.google.com/maps/search/?api=1&query=${encodedCoordinates}&query_place_id=${placeId}`;
        } else if (placeId && hasAddress) {
            // Fallback: use address with place_id (graceful degradation if place_id doesn't exist)
            return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}&query_place_id=${placeId}`;
        } else if (hasAddress) {
            // Fallback: address only
            return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
        } else if (hasCoordinates) {
            // Final fallback: coordinates only
            return `https://www.google.com/maps/search/?api=1&query=${encodedCoordinates}`;
        } else if (encodedFallbackQuery) {
            // Final fallback: venue/city only (useful when no address or coordinates)
            const placeIdParam = placeId ? `&query_place_id=${placeId}` : '';
            return `https://www.google.com/maps/search/?api=1&query=${encodedFallbackQuery}${placeIdParam}`;
        }
        return null;
    }

    // Enrich event with Google Maps links and city information
    enrichEventLocation(event) {
        if (!event) return event;

        // DEBUG: Check URL field before enrichment
        const hadUrlBefore = 'url' in event;
        const urlValueBefore = event.url;

        // Extract and normalize city (parser may have set it for venue-specific logic, but we need to normalize it)
        const extractedCity = this.extractCityFromEvent(event);
        if (extractedCity) {
            event.city = extractedCity;
        }

        // Warn when the event references a city we have no config for (timezone-aware key building would fall back to UTC)
        if (!event.timezone && event.city && !this.cities[event.city]) {
            const title = event.title || 'unknown';
            this.warnOnce(
                `timezone:${event.city}`,
                `🚨 SharedCore: No timezone config for city "${event.city}" (event: "${title}")`
            );
        }

        // Check if venue name indicates TBA/placeholder (these often have fake addresses/coordinates)
        const isTBAVenue = event.bar && (
                          event.bar.toLowerCase().includes('tba') ||
                          event.bar.toLowerCase().includes('to be announced'));

        if (isTBAVenue) {
            console.log(`🗺️ SharedCore: TBA venue "${event.bar}" detected - removing fake location data`);
            // Remove all location data for TBA venues (coordinates are usually fake city center)
            event.location = null;
            event.address = null;
            event.gmaps = '';
            return event;
        }

        // Generate iOS-compatible Google Maps URL using available data (address, coordinates, place_id)
        // Always generate if gmaps field is empty or undefined - merge strategies are handled later
        if (!event.gmaps) {
            // Try to enhance incomplete addresses with city information before gmaps generation
            if (event.address && event.city && !this.isFullAddress(event.address)) {
                const enhancedAddress = this.enhanceAddressWithCity(event.address, event.city);
                if (enhancedAddress !== event.address) {
                    event.address = enhancedAddress;
                }
            }

            // Parse coordinates from location field if available
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

            // Use available data to generate iOS-compatible URL
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
            console.error(`🗺️ SharedCore: URL FIELD LOST in enrichEventLocation for "${event.title}"!`);
            console.error(`🗺️ SharedCore: Before: hadUrl=${hadUrlBefore}, value="${urlValueBefore}"`);
            console.error(`🗺️ SharedCore: After: hasUrl=${hasUrlAfter}, value="${urlValueAfter}"`);
        }

        return event;
    }

    // Check if an address is a full address (not just a city or region)
    isFullAddress(address) {
        if (!address || typeof address !== 'string') return false;

        // Clean up the address
        const cleanAddress = address.trim();
        if (cleanAddress.length < 10) return false; // Too short to be a full address

        // Check for TBA or similar placeholder values (including venue names)
        if (/^(TBA|TBD|To Be Announced|To Be Determined)$/i.test(cleanAddress)) {
            return false;
        }

        // Check for other placeholder patterns that indicate incomplete addresses
        const placeholderPatterns = [
            /^(venue|location|address)?\s*(tba|tbd|pending|coming soon|announced soon)$/i,
            /^(details|info|information)?\s*(coming|to follow|tba|tbd)$/i,
            /^(will be announced|location pending|venue pending)$/i
        ];

        if (placeholderPatterns.some(pattern => pattern.test(cleanAddress))) {
            return false;
        }

        // Check for partial addresses that are just area/neighborhood + city + zip
        // Examples: "DTLA Los Angeles, CA 90013", "Downtown Denver, CO 80202"
        const partialAddressPatterns = [
            /^(DTLA|Downtown|Midtown|Uptown|North|South|East|West|Central)\s*,?\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}$/i,
            /^[A-Za-z\s]+\s+(District|Area|Zone|Neighborhood)\s*,?\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}$/i
        ];

        // If it matches a partial address pattern, it's not a full address
        if (partialAddressPatterns.some(pattern => pattern.test(cleanAddress))) {
            return false;
        }

        // Check for common full address patterns
        const fullAddressPatterns = [
            /\d+\s+\w+.*street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|place|pl|court|ct/i,
            /\d+\s+\w+.*\s+\w+/i // Number + words (likely street address)
        ];

        // Must contain at least one full address pattern
        const hasAddressPattern = fullAddressPatterns.some(pattern => pattern.test(cleanAddress));
        if (!hasAddressPattern) return false;

        // Check if it's just a city name (common city patterns to exclude)
        const cityOnlyPatterns = [
            /^(new york|nyc|los angeles|san francisco|chicago|atlanta|miami|seattle|portland|denver|las vegas|vegas|boston|philadelphia|austin|dallas|houston|phoenix|toronto|london|berlin|palm springs|sitges)$/i,
            /^[a-z\s]{3,25}$/i // Simple city name pattern (3-25 characters, letters and spaces only)
        ];

        // If it matches a city-only pattern and has no numbers/street indicators, it's not a full address
        const isCityOnly = cityOnlyPatterns.some(pattern => pattern.test(cleanAddress)) &&
                          !/\d/.test(cleanAddress) &&
                          !/street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|place|pl|court|ct/i.test(cleanAddress);

        return !isCityOnly;
    }

    // Enhance address with city information if it's incomplete
    enhanceAddressWithCity(address, city) {
        if (!address || !city || !this.cityMappings) {
            return address;
        }

        // Find city data from cityMappings (which uses "patterns|patterns" format)
        let cityName = '';
        for (const [patterns, mappedCity] of Object.entries(this.cityMappings)) {
            if (mappedCity === city) {
                // Use the longest pattern as it's likely the most complete city name
                const patternList = patterns.split('|');
                cityName = patternList.reduce((longest, current) =>
                    current.length > longest.length ? current : longest
                );
                break;
            }
        }

        if (!cityName) {
            return address; // No city patterns found
        }

        // Check if address already contains city information (city name or state)
        const lowerAddress = address.toLowerCase();
        const lowerCityName = cityName.toLowerCase();

        // Check for city name or any US state abbreviation
        const stateAbbreviations = [
            'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl',
            'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me',
            'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh',
            'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
            'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'
        ];

        if (lowerAddress.includes(lowerCityName) ||
            stateAbbreviations.some(state => lowerAddress.includes(`, ${state}`))) {
            return address; // Already contains city/state info
        }

        // Check if address needs enhancement (incomplete street address)
        const needsEnhancement =
            // Very short addresses
            address.length < 15 ||
            // No comma (likely missing city/state)
            !address.includes(',') ||
            // Just street number and name pattern
            /^\d+\s+[NSEW]?\.?\s*[A-Za-z\s]+$/i.test(address.trim());

        if (needsEnhancement) {
            // Add proper capitalization to city name
            const properCityName = cityName.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');

            return `${address.trim()}, ${properCityName}`;
        }

        return address;
    }

    // Resolve a primary city name for map queries from a city key
    getPrimaryCityName(cityKey) {
        if (!cityKey || !this.cityMappings) {
            return '';
        }

        const normalizedKey = String(cityKey).trim();
        if (!normalizedKey || normalizedKey === 'unknown') {
            return '';
        }

        for (const [patterns, mappedCity] of Object.entries(this.cityMappings)) {
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
        if (!address || typeof address !== 'string') return null;

        const lowerAddress = address.toLowerCase();

        // First try exact matches in address
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                // Use word boundaries to avoid substring matches (e.g., "la" in "Atlanta")
                const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (regex.test(lowerAddress)) {
                    return city;
                }
            }
        }

        // Try to extract city name from address components
        const addressParts = address.split(',').map(part => part.trim());

        // Check each address part for city matches
        for (const part of addressParts) {
            const cityName = part.toLowerCase();

            // Check if the city matches our mappings (includes misspellings in patterns)
            for (const [patterns, city] of Object.entries(this.cityMappings)) {
                const patternList = patterns.split('|');
                for (const pattern of patternList) {
                    // Try exact match first (simpler and more reliable)
                    if (cityName === pattern) {
                        return city;
                    }
                    // Then use word boundaries to avoid substring matches
                    const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                    if (regex.test(cityName)) {
                        return city;
                    }
                }
            }
        }

        // If no city found in any part, try normalizing the first part
        if (addressParts.length > 0) {
            const firstPart = addressParts[0].toLowerCase();
            const normalizedCity = this.normalizeCityName(firstPart);
            return normalizedCity;
        }

        return null;
    }

    // Extract city from text content (titles, descriptions, etc.)
    extractCityFromText(text) {
        if (!text || typeof text !== 'string') return null;

        const lowerText = text.toLowerCase();

        // Check each city mapping pattern
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                // Use word boundaries for precise matching
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
        // Try city field first
        if (event.city) {
            // Normalize the city name to handle misspellings like "boton" -> "boston"
            const normalizedCity = this.normalizeCityName(String(event.city));
            return normalizedCity;
        }

        // Try to extract from title
        const title = String(event.title || '').toLowerCase();

        // Check for city names in title
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (title.includes(pattern)) {
                    return city;
                }
            }
        }

        // Try to extract from venue address or name
        const venue = String(event.bar || '').toLowerCase();
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (venue.includes(pattern)) {
                    return city;
                }
            }
        }

        // Try venue address first (keeping venue for backward compatibility with eventbrite data structure)
        if (event.venue?.address) {
            const address = event.venue.address;
            const cityFromAddress = address.city || address.localized_area_display || '';
            if (cityFromAddress) {
                return this.normalizeCityName(cityFromAddress);
            }
        }

        // Try address field
        if (event.address) {
            const cityFromAddress = this.extractCityFromAddress(event.address);
            if (cityFromAddress) {
                return cityFromAddress;
            }
        }

        // Try extracting from text content
        const searchText = `${event.title || event.name || ''} ${event.description || ''} ${event.bar || ''}`;
        const cityFromText = this.extractCityFromText(searchText);
        if (cityFromText) {
            return cityFromText;
        }

        return 'unknown';
    }

    // Normalize city name to lowercase, handle common variations
    normalizeCityName(cityName) {
        if (!cityName || typeof cityName !== 'string') return null;

        const normalized = cityName.toLowerCase().trim();

        // Check if normalized name matches any of our mappings
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            if (patternList.includes(normalized)) {
                return city;
            }
        }

        // Return as-is if no mapping found
        if (normalized && this.cities && !this.cities[normalized]) {
            this.warnOnce(`city:${normalized}`, `⚠️ SharedCore: Unknown city "${normalized}" (no mapping or timezone)`);
        }
        return normalized;
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
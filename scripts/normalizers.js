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

    async normalizeEventAsync(event, httpAdapter, options = {}) {
        if (!event) return event;
        let normalized = { ...event };
        for (const normalizer of this.normalizers) {
            normalized = normalizer.normalize(normalized);
            if (typeof normalizer.normalizeAsync === 'function') {
                normalized = await normalizer.normalizeAsync(normalized, httpAdapter, options);
            }
        }
        return normalized;
    }

    async normalizeEventsAsync(events, httpAdapter, options = {}) {
        if (!Array.isArray(events)) return [];
        const normalizedEvents = [];
        for (const event of events) {
            normalizedEvents.push(await this.normalizeEventAsync(event, httpAdapter, options));
        }
        return normalizedEvents;
    }
}

class BaseNormalizer {
    constructor(core) {
        this.core = core;
    }

    // Diacritic-folded lowercase view of city-ish text ("Montréal" →
    // "montreal") so accented extractions match the unaccented city config
    // patterns (run 20260727-145617). Canonical implementation lives in
    // SharedCore.foldDiacritics; the inline fallback keeps normalizers pure
    // when constructed without a core (keep the transform in sync).
    foldDiacritics(value) {
        if (this.core && typeof this.core.foldDiacritics === 'function') {
            return this.core.foldDiacritics(value);
        }
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    // Coordinate-pair check kept local so the normalizers stay platform-pure
    // (mirrors SharedCore.isCoordinatePair: two finite floats, lat within ±90,
    // lng within ±180). On the base class because both the page-provenance
    // stamp and the maps-link pin rung need it.
    isCoordinatePairString(value) {
        if (typeof value !== 'string') return false;
        const match = value.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
        if (!match) return false;
        const lat = Number(match[1]);
        const lng = Number(match[2]);
        return Number.isFinite(lat) && Number.isFinite(lng)
            && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    }

    normalize(event) {
        return event;
    }
}

class BasicDataNormalizer extends BaseNormalizer {
    normalize(event) {
        // Stamp page-provenance defaults BEFORE any bar match or geocoding runs
        // (BasicDataNormalizer is first in the pipeline, ahead of BarData and
        // OSM in both the sync and async paths). Coordinates/address that
        // arrived on the event from the parser (JSON-LD/page text) are
        // provenance 'page'; the later writers OVERWRITE the source only when
        // THEY set/replace the value (bar→curated, geocode→geocoded-*,
        // reverse→inferred). Pure and idempotent — only stamps an unset source
        // when the corresponding value is present.
        event = this.stampPageProvenanceDefaults(event);

        // Recurring-series stamp: a non-empty recurrenceRule (AI-extracted
        // RRULE) marks this event as a series definition. Series are
        // display+export only — the calendar-write path withholds _recurring
        // events (owner imports the ICS instead; the scraper never writes
        // recurring series). Pure and idempotent.
        if (typeof event.recurrenceRule === 'string' && event.recurrenceRule.trim() !== '') {
            event._recurring = true;
        }

        if (!this.core) return event;
        // Sync URL and website fields
        event = this.syncUrlAndWebsiteFields(event);

        // Normalize basic text fields
        return this.core.normalizeEventTextFields(event);
    }

    stampPageProvenanceDefaults(event) {
        if (!event || typeof event !== 'object') return event;
        if (!event.pinSource && this.isCoordinatePairString(event.location)) {
            event.pinSource = 'page';
        }
        if (!event.addressSource && typeof event.address === 'string' && event.address.trim().length > 0) {
            event.addressSource = 'page';
        }
        return event;
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

            // Canonicalize a PRESENT bar name to the curated display name when
            // it matches a curated bar by strict full-name equality
            // (findCuratedBarByName / normalizeBarNameKey — the #1536/#1537
            // contract; "Massive Club" ≠ "Massive", never substring, so only
            // spelling/casing/punctuation variants of the SAME name rewrite).
            // Run 20260725-210227 shipped bar "MASSIVE" (BEARRACUDA: Seattle)
            // next to "Massive" (Treasure Trail Seattle) for the same venue.
            // Complements the rewrite above, which only fires when event.bar
            // was empty or came from title/description. Uncurated bars never
            // reach here (no strict match) and are left untouched.
            if (typeof event.bar === 'string' && event.bar.trim() !== ''
                && typeof this.core.findCuratedBarByName === 'function') {
                const curatedBar = this.core.findCuratedBarByName(cityBars, event.bar);
                if (curatedBar && typeof curatedBar.name === 'string'
                    && curatedBar.name.trim() !== ''
                    && event.bar !== curatedBar.name) {
                    console.log(`🐻 BarDataNormalizer: Canonicalized bar name "${event.bar}" → "${curatedBar.name}" (curated)`);
                    event.bar = curatedBar.name;
                    modified = true;
                }
            }

            // Remove description if it was just the venue name
            if (descriptionWasVenue && event.description) {
                delete event.description;
                modified = true;
            }

            // Prefer the bar's full address if missing in event. A PRESENT
            // address is only ever replaced by the district-fragment upgrade
            // rung below — never on length alone (fail closed: a shorter but
            // non-contained address like "Calle Casablanca 5" may be a genuine
            // contradiction of curated data and must survive to the merge).
            if (matchedBar.address && !event.address) {
                event.address = matchedBar.address;
                event.addressSource = 'curated';
                modified = true;
            }

            // District-to-curated address upgrade rung: the event's address is
            // a bare district/neighborhood fragment of the curated bar's
            // street address ("LA NOGALERA" ⊂ "Calle Danza Invisible, La
            // Nogalera 710, 29620 Torremolinos") — upgrade it to the curated
            // street address. Strictly gated on the event's BAR matching a
            // curated bar (findCuratedBarByName full-name equality), so
            // containment is only ever checked against that one bar's address.
            if (this.upgradeDistrictAddressToCurated(event)) {
                modified = true;
            }

            // Prefer the bar's coordinates if missing in event
            if (matchedBar.coordinates && !event.location) {
                event.location = matchedBar.coordinates;
                event.pinSource = 'curated';
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

    // Deterministic district-to-curated address upgrade. Fires only when ALL
    // of the following hold (anything else returns false — fail closed):
    //   1. the event carries a non-empty bar that matches a curated bar for
    //      its city via SharedCore.findCuratedBarByName (full-name equality —
    //      the bar match is strictly the gate; a district address is NEVER
    //      compared against curated bars the event's bar does not name);
    //   2. the event's current address, normalized with the same token family
    //      the merge address rungs use (SharedCore.normalizeAddressTokens —
    //      case-insensitive, whitespace/punctuation/diacritic tolerant,
    //      abbreviations expanded), is a PROPER contiguous fragment of that
    //      one curated bar's normalized address. Identical addresses need no
    //      upgrade; a non-contained address is a potential contradiction of
    //      curated data and is never replaced.
    // On upgrade: address becomes the curated street address, addressSource
    // is stamped 'curated', and an additive 🗺️ GEOCODE VERIFY line records
    // the replacement. Returns true when the event was modified.
    upgradeDistrictAddressToCurated(event) {
        if (!event || !this.core) return false;
        if (typeof this.core.findCuratedBarByName !== 'function'
            || typeof this.core.getCuratedCityBars !== 'function'
            || typeof this.core.normalizeAddressTokens !== 'function') return false;
        const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
        const address = typeof event.address === 'string' ? event.address.trim() : '';
        if (!bar || !address) return false;
        const cityBars = this.core.getCuratedCityBars(event.city);
        if (!cityBars) return false;
        const curatedBar = this.core.findCuratedBarByName(cityBars, bar);
        if (!curatedBar || typeof curatedBar.address !== 'string' || curatedBar.address.trim() === '') return false;
        const eventTokens = this.core.normalizeAddressTokens(address);
        const curatedTokens = this.core.normalizeAddressTokens(curatedBar.address);
        // Proper fragment only: an equal-or-longer token sequence is either
        // already the curated address or something the rung must not touch.
        if (eventTokens.length === 0 || eventTokens.length >= curatedTokens.length) return false;
        let contained = false;
        for (let start = 0; start + eventTokens.length <= curatedTokens.length && !contained; start++) {
            let matches = true;
            for (let offset = 0; offset < eventTokens.length; offset++) {
                if (curatedTokens[start + offset] !== eventTokens[offset]) { matches = false; break; }
            }
            contained = matches;
        }
        if (!contained) return false;
        const title = typeof event.title === 'string' && event.title.trim() ? event.title.trim() : 'event';
        event.address = curatedBar.address;
        event.addressSource = 'curated';
        console.log(`🗺️ GEOCODE VERIFY: "${title}" upgraded district address "${address}" to curated bar address "${curatedBar.address}" (bar: ${curatedBar.name})`);
        return true;
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

        // Curated-bar → city backfill: an event whose page never names its
        // city (run 20260724-161423: massive.club events came out
        // city "unknown") can still resolve when its bar is a curated bar.
        // Runs BEFORE resolveWallClockDates below so the recovered city lets
        // timezone resolution re-anchor the wall-clock dates.
        this.backfillCityFromCuratedBar(event);

        // Warn when the event references a city we have no config for
        // (diacritic-folded lookup so "Montréal" counts as configured)
        if (!event.timezone && event.city && this.core.cities
            && !this.core.cities[event.city] && !this.core.cities[this.foldDiacritics(event.city)]) {
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
            // City context is QUERY-time decoration only: incomplete addresses
            // get the city appended for the maps lookup below, but the
            // PERSISTED event.address must never gain a city that came from
            // city RESOLUTION rather than from source text (run
            // 20260723-123149: extracted "LA NOGALERA" was stored as
            // "LA NOGALERA, Manhattan" off a wrong city, cementing the error).
            let queryAddress = event.address;
            if (event.address && event.city && !this.isFullAddress(event.address)) {
                const enhancedAddress = this.enhanceAddressWithCity(event.address, event.city);
                if (enhancedAddress !== event.address) {
                    queryAddress = enhancedAddress;
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

            const hasFullAddress = queryAddress && this.isFullAddress(queryAddress);
            const shouldPreferAddress = hasFullAddress && !event.placeId;
            const addressForMaps = (hasFullAddress || !coordinates) ? queryAddress : null;
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

        // Diacritic-folded on BOTH sides so "Montréal, QC" matches the
        // unaccented "montreal" pattern (run 20260727-145617)
        const lowerAddress = this.foldDiacritics(address);

        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                const foldedPattern = this.foldDiacritics(pattern);
                const regex = new RegExp(`\\b${foldedPattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (regex.test(lowerAddress)) {
                    return city;
                }
            }
        }

        const addressParts = address.split(',').map(part => part.trim());

        for (const part of addressParts) {
            const cityName = this.foldDiacritics(part);

            for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
                const patternList = patterns.split('|');
                for (const pattern of patternList) {
                    const foldedPattern = this.foldDiacritics(pattern);
                    if (cityName === foldedPattern) {
                        return city;
                    }
                    const regex = new RegExp(`\\b${foldedPattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
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

        // Diacritic-folded on BOTH sides (see extractCityFromAddress)
        const lowerText = this.foldDiacritics(text);

        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                const foldedPattern = this.foldDiacritics(pattern);
                const regex = new RegExp(`\\b${foldedPattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
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

    // Curated-bar → city backfill (fail closed everywhere): fills event.city
    // ONLY when it is missing/empty/"unknown" AND the event's bar matches a
    // curated bar by strict full-name equality (normalizeBarNameKey — the
    // findCuratedBarByName contract, so "Eagle" never claims "Dallas Eagle")
    // in exactly ONE city. A name curated in multiple cities is ambiguous and
    // is never backfilled; a name that is a generic franchise stem (contained
    // inside another curated bar's name key, e.g. "Eagle" ⊂ "Dallas Eagle")
    // is never backfilled either. A present city that differs is NEVER
    // overwritten.
    // Provenance is stamped via the existing _citySource convention
    // (underscore fields stay out of serialized output).
    backfillCityFromCuratedBar(event) {
        if (!event || !this.core || typeof this.core.findCuratedBarCityByName !== 'function') return event;
        const currentCity = typeof event.city === 'string' ? event.city.trim().toLowerCase() : '';
        if (currentCity && currentCity !== 'unknown') return event;
        const barName = typeof event.bar === 'string' ? event.bar.trim() : '';
        if (!barName) return event;
        const result = this.core.findCuratedBarCityByName(barName);
        if (!result) return event;
        const title = event.title || 'unknown';
        if (result.ambiguousCities) {
            console.log(`🗺️ LocationNormalizer: City backfill skipped for "${title}" — bar "${barName}" is curated in multiple cities (${result.ambiguousCities.join(', ')})`);
            return event;
        }
        // Generic-name-stem refusal (run 20260725-170926: truncated bar "Eagle"
        // uniquely matched fort-lauderdale's curated "Eagle" and backfilled
        // that city onto Dallas Eagle events). The curated corpus itself flags
        // the stem — no word lists — so fail closed and leave city unknown.
        if (result.genericStem) {
            console.log(`🗺️ LocationNormalizer: City backfill skipped for "${title}" — bar "${barName}" is a generic name stem (contained in: ${result.containedIn.join(', ')})`);
            return event;
        }
        event.city = result.city;
        event._citySource = 'curated-bar';
        console.log(`🗺️ LocationNormalizer: Backfilled city "${result.city}" from curated bar "${result.bar.name}" for "${title}"`);
        return event;
    }

    extractCityFromEvent(event) {
        if (event.city) {
            const normalizedCity = this.normalizeCityName(String(event.city));
            return normalizedCity;
        }

        if (!this.core || !this.core.cityMappings) return 'unknown';

        // Diacritic-folded on BOTH sides so "Montréal" in a title/venue
        // matches the unaccented "montreal" pattern (run 20260727-145617)
        const title = this.foldDiacritics(event.title);

        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (title.includes(this.foldDiacritics(pattern))) {
                    return city;
                }
            }
        }

        const venue = this.foldDiacritics(event.bar);
        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (venue.includes(this.foldDiacritics(pattern))) {
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
        // Diacritic-folded on BOTH sides: "Montréal"/"MONTRÉAL" must resolve
        // to the montreal key (run 20260727-145617); unaccented input folds
        // to itself so ASCII matching is byte-identical.
        const folded = this.foldDiacritics(cityName);

        for (const [patterns, city] of Object.entries(this.core.cityMappings)) {
            const patternList = patterns.split('|');
            if (patternList.includes(normalized) || patternList.some(pattern => this.foldDiacritics(pattern) === folded)) {
                return city;
            }
        }

        if (normalized && this.core.cities && !this.core.cities[normalized] && !this.core.cities[folded]) {
            this.core.warnOnce(`city:${normalized}`, `⚠️ LocationNormalizer: Unknown city "${normalized}" (no mapping or timezone)`);
        }
        return normalized;
    }
}


// Forward-geocode candidates farther than this from the event city's center are
// rejected: a candidate 50+ km away is a same-named street/place in another city.
const CITY_CENTER_RADIUS_KM = 50;

// Hard cap on Nominatim requests per event for the forward-geocode retry
// ladder. 6 covers the full ladder (name+address, canonical address,
// unit/suite strip, postal/country strip, directional strip, venue-name
// rescue). It was 5 before the name-led rung was added in front; raising it by
// exactly one keeps every rung that existed then reachable — capping at 5
// would have silently dropped the venue+city rescue for address-bearing
// events. The added request only exists when an event has BOTH a bar and an
// address, and only fires when the name-led query returns nothing; every request
// stays 1.1s-throttled and later rungs only fire after earlier ones return
// nothing usable. A single US Census rescue request (US-looking addresses
// only) and a single Photon rescue request may follow when every Nominatim
// rung fails; both share the same rate limiter. Never raise this without
// revisiting the rate-limit budget.
const MAX_GEOCODE_QUERIES_PER_EVENT = 6;

// POI-adopted pins only: how far apart the reverse-geocoded house number and
// the adopted address's house number may sit (same street) before the reverse
// cross-check refuses the pin. Two map providers routinely interpolate the
// SAME building to nearby numbers (run 20260723-152928: Apple said "75
// Warrenton St" for OSM's "79 Warrenton Street" — the pin was refused and the
// event ended with neither address nor pin). 20 covers provider interpolation
// drift without accepting a different block. Regular address-geocoded pins
// keep the strict exact-house comparison.
const POI_PIN_HOUSE_NUMBER_TOLERANCE = 20;

// How far a page's maps-link pin (the ll= param a ticketing page publishes,
// harvested by the AI web parser behind its venue-identity guard) may sit from
// the pin the pipeline actually accepted before the disagreement is worth a
// human's attention. The measured spread decides it:
//   - Royal Vauxhall Tavern: ll= vs geocode  6 m — the same building;
//   - Horizon:               ll= is 181 m from truth (the right venue, coarse
//     platform geocode) — an imprecise pin, not a wrong one;
//   - Westminster Pier:      ll= is 936 m from truth, on a DIFFERENT pier —
//     the platform geocoded the street loosely and landed at Embankment Pier.
// 300 m clears the worst observed BENIGN error (181 m) with room, and sits
// well under the wrong-venue case (936 m), so the line fires for "these are
// different places" and stays quiet for "same place, coarser pin". It only
// governs a LOG: the accepted pin never changes because of it.
const MAPS_LINK_CONFLICT_METERS = 300;

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

// Forward-geocode grade tiers, shared between Nominatim (class/type/addresstype
// plus address.house_number) and Photon (osm_key/osm_value plus housenumber):
//   exact  — a concrete venue/building or a house-numbered address match.
//   street — a road-level match; tolerable only when the input address carries
//            no house number (or the verification mode allows flagged accepts).
//   coarse — a city/borough/suburb/state centroid. A coarse pin is always
//            worse than no pin and is refused in EVERY verification mode.
const GEOCODE_EXACT_GRADE_CLASSES = [
    'building', 'amenity', 'shop', 'leisure', 'tourism', 'office', 'club', 'craft', 'nightclub'
];
const GEOCODE_STREET_GRADE_TYPES = ['road', 'street', 'pedestrian'];
const GEOCODE_COARSE_GRADE_TYPES = [
    'city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter', 'borough',
    'state', 'county', 'postcode', 'country'
];

// Street abbreviations expanded on BOTH sides of the reverse cross-check so
// "Folsom St" / "Folsom Street" and "E" / "East" compare equal.
const GEOCODE_ABBREVIATION_EXPANSIONS = {
    st: 'street', ave: 'avenue', blvd: 'boulevard', rd: 'road', dr: 'drive',
    ln: 'lane', hwy: 'highway', pl: 'place', ct: 'court',
    e: 'east', w: 'west', n: 'north', s: 'south'
};
// Overlap on generic street-type/directional words alone never proves two
// street names match ("Mission Street" vs "Folsom Street" share "street").
const GEOCODE_GENERIC_STREET_TOKENS = [
    'street', 'avenue', 'boulevard', 'road', 'drive', 'lane', 'highway',
    'place', 'court', 'east', 'west', 'north', 'south', 'way', 'the'
];

// Generic venue-type words stripped SYMMETRICALLY from the tail of both sides
// of the geo-POI ↔ bar comparison ("Massive" matches the map POI "Massive
// Nightclub"), only ever when a non-empty remainder is left. The remainder
// must equal the other side token-for-token — never a substring — so "Eagle"
// can't claim "Eagle Creek Cafe".
const GEOCODE_GENERIC_VENUE_SUFFIXES = [
    'nightclub', 'club', 'bar', 'lounge', 'theater', 'theatre', 'tavern', 'pub', 'hall'
];

// Unit/suite decoration ("Suite 200", "#4", "#UNIT 114", "Apt 5B", "Fl. 2")
// that chokes Nominatim's free-text parser; stripped as its own retry rung.
// Three alternatives (2026-07-15 run findings shaped each one):
//   1. "#" markers, optionally naming the unit kind — "#UNIT 114" must go
//      entirely (stripping only "#UNIT" left a dangling "114").
//   2. Bare unit words with their following token, or trailing with NO token
//      before a comma/end ("333 S Palm Canyon Dr Unit, Palm Springs").
//   3. Dotted "fl."/"rm." abbreviations — the dot is REQUIRED so a state+ZIP
//      tail like ", FL 33101" never matches ("floor"/"room" stay bare words).
// Word tokens are boundary-guarded so street names like "Halsted", "Steiner"
// or "Sainte-Catherine" pass through untouched.
const GEOCODE_UNIT_TOKEN_RE = new RegExp(
    ',?\\s*(?:' +
        '#\\s*(?:(?:ste|suite|apt|unit|floor|room)\\b\\.?\\s*)?[^\\s,]*' +
        '|(?:ste|suite|apt|unit|floor|room)\\b\\.?(?:\\s+[^\\s,]+|(?=\\s*(?:,|$)))' +
        '|(?:fl|rm)\\.\\s*[^\\s,]+' +
    ')',
    'gi'
);

// Leading street number ("1192 Folsom St"). Used only to decide whether a
// street-grade pin is tolerable for this input — a house-numbered address
// deserves better than a road centroid.
const GEOCODE_HOUSE_NUMBER_RE = /(^|\s)\d+[a-z]?\s+\S/i;

// Any street-type word on its own word boundary ("Folsom St", "Mt Nebo Rd").
// Together with GEOCODE_HOUSE_NUMBER_RE this decides whether an INPUT address
// carries street-level detail at all — see isStreetSpecificAddress.
const GEOCODE_STREET_TYPE_WORD_RE = new RegExp(`\\b(?:${GEOCODE_STREET_TYPE_WORDS})\\b`, 'i');

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

    // Input-specificity gate for geocode-backed reviewer proposals: an address
    // without street-level detail ("Poconos, PA", "LA NOGALERA, Torremolinos")
    // asks a question no geocoder can answer precisely — whatever it returns
    // (even an exact-grade POI) is an arbitrary same-named candidate, never
    // proposal material. Street-specific = a house number OR a street-type word.
    isStreetSpecificAddress(address) {
        const text = String(address || '');
        return GEOCODE_HOUSE_NUMBER_RE.test(text) || GEOCODE_STREET_TYPE_WORD_RE.test(text);
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
        const cityConfig = this.core.cities[key] || this.core.cities[this.foldDiacritics(key)];
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

    // Grade a forward-geocode candidate into the exact/street/coarse tiers (see
    // the tier constants above). Kinds that fit no tier grade as 'street': never
    // silently refused, but suspect enough to flag/replace for a house-numbered
    // input.
    classifyGeocodeGrade(resultClass, resultType, addressType, hasHouseNumber) {
        const cls = String(resultClass || '').toLowerCase();
        const type = String(resultType || '').toLowerCase();
        const addr = String(addressType || '').toLowerCase();
        if (hasHouseNumber || GEOCODE_EXACT_GRADE_CLASSES.includes(cls)) return 'exact';
        if (cls === 'highway' || GEOCODE_STREET_GRADE_TYPES.includes(addr)) return 'street';
        if (GEOCODE_COARSE_GRADE_TYPES.includes(addr) || GEOCODE_COARSE_GRADE_TYPES.includes(type) ||
            cls === 'place' || cls === 'boundary') return 'coarse';
        return 'street';
    }

    gradeNominatimResult(result) {
        if (!result || typeof result !== 'object') return 'coarse';
        const details = result.address && typeof result.address === 'object' ? result.address : {};
        return this.classifyGeocodeGrade(result.class, result.type, result.addresstype, !!details.house_number);
    }

    // "1192 Folsom St Suite 200, San Francisco" → "1192 Folsom St, San
    // Francisco": unit/suite/floor decoration chokes Nominatim's free-text
    // parser. Returns the address unchanged when no unit token is present.
    stripUnitTokens(address) {
        return String(address || '')
            .replace(GEOCODE_UNIT_TOKEN_RE, '')
            .replace(/\s{2,}/g, ' ')
            .replace(/\s+,/g, ',')
            .replace(/^[,\s]+|[,\s]+$/g, '');
    }

    // Lowercased, punctuation-free tokens with street abbreviations expanded —
    // the comparable form used on both sides of the reverse cross-check.
    expandAddressTokens(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(token => Object.prototype.hasOwnProperty.call(GEOCODE_ABBREVIATION_EXPANSIONS, token)
                ? GEOCODE_ABBREVIATION_EXPANSIONS[token]
                : token);
    }

    extractHouseNumber(text) {
        const match = /(^|\s)(\d+[a-z]?)\s+\S/i.exec(String(text || ''));
        return match ? match[2].toLowerCase() : '';
    }

    // Lenient reverse cross-check: compare an Apple placemark (subThoroughfare/
    // thoroughfare/locality/postalCode) against the input address. Returns
    // { matched, got } or null when the two sides share nothing comparable —
    // this is a tripwire, not a parser.
    comparePinToAddress(placemark, address) {
        if (!placemark || typeof placemark !== 'object') return null;
        const clean = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
        const pinHouse = clean(placemark.subThoroughfare).toLowerCase();
        const pinStreet = clean(placemark.thoroughfare);
        const pinLocality = clean(placemark.locality);
        const pinPostal = clean(placemark.postalCode);
        const got = [pinHouse, pinStreet, pinLocality].filter(part => part.length > 0).join(' ') || pinPostal || 'unknown place';
        const inputTokens = this.expandAddressTokens(address);
        const inputHouse = this.extractHouseNumber(address);

        // Street-name comparison: at least one distinctive (non-generic,
        // non-numeric) token of the pin's street must appear in the input.
        // The street-branch result additionally carries streetMatched/
        // pinHouse/inputHouse (additive fields) so the POI-adoption tolerance
        // in confirmGeocodeCandidate can tell "same street, different house
        // number" apart from a genuinely different street.
        const streetTokens = this.expandAddressTokens(pinStreet)
            .filter(token => !GEOCODE_GENERIC_STREET_TOKENS.includes(token) && !/^\d/.test(token));
        if (streetTokens.length > 0 && inputTokens.length > 0) {
            const streetMatch = streetTokens.some(token => inputTokens.includes(token));
            const houseMatch = inputHouse && pinHouse ? inputHouse === pinHouse : true;
            return { matched: streetMatch && houseMatch, got, streetMatched: streetMatch, pinHouse, inputHouse };
        }

        // No street to compare — fall back to postal code, then locality.
        const zipMatch = /\b(\d{5})(?:-\d{4})?\b/.exec(String(address || ''));
        if (zipMatch && pinPostal) {
            return { matched: zipMatch[1] === pinPostal.slice(0, 5), got };
        }
        if (pinLocality && inputTokens.length > 0) {
            const localityTokens = this.expandAddressTokens(pinLocality);
            return { matched: localityTokens.some(token => inputTokens.includes(token)), got };
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Geo-POI harvest + bar corroboration (bar corroboration phase 3): the
    // geocoder responses the pipeline ALREADY fetches name the place at the
    // pinned coordinates; when that map-grade name matches the event's bar,
    // the bar is corroborated by an authority independent of the source page.
    // ZERO new network calls — every name below rides on a response an
    // existing rung fetched anyway.
    // -----------------------------------------------------------------------

    // POI name from a forward-geocode result the ladder picked. Prefer the
    // explicit name field(s); fall back to the leading display_name component,
    // which is the POI for venue hits ("Massive, 619, East Pine Street, …")
    // but the house number for bare-address hits ("619, East Pine Street, …")
    // — leading-digit components are never harvested. Photon results reuse
    // this via { name: properties.name } (no display_name → same guards).
    extractNominatimPoiName(result) {
        if (!result || typeof result !== 'object') return '';
        const clean = value => typeof value === 'string' ? value.trim() : '';
        const explicit = clean(result.name)
            || (result.namedetails && typeof result.namedetails === 'object'
                ? clean(result.namedetails.name)
                : '');
        if (explicit && !/^\d/.test(explicit)) return explicit;
        const first = clean(String(result.display_name || '').split(',')[0]);
        if (first && !/^\d/.test(first)) return first;
        return '';
    }

    // POI names from an Apple reverse placemark the cross-check already
    // fetched: `name` plus any `areasOfInterest` entries. Apple sets `name`
    // to the street address line when it knows no POI at the point — leading-
    // digit names and names equal to the thoroughfare are skipped. Cached
    // placemarks from before these fields were harvested simply lack them →
    // empty harvest (fail open).
    extractPlacemarkPoiNames(placemark) {
        if (!placemark || typeof placemark !== 'object') return [];
        const clean = value => typeof value === 'string' ? value.trim() : '';
        const names = [];
        const thoroughfare = clean(placemark.thoroughfare).toLowerCase();
        const name = clean(placemark.name);
        if (name && !/^\d/.test(name) && name.toLowerCase() !== thoroughfare) {
            names.push(name);
        }
        if (Array.isArray(placemark.areasOfInterest)) {
            for (const area of placemark.areasOfInterest) {
                const areaName = clean(area);
                if (areaName && !/^\d/.test(areaName)) names.push(areaName);
            }
        }
        return names;
    }

    // Names attached to an accepted pin: the forward result's POI (exact-grade
    // hits only — a street hit's "name" is the street, not a venue) plus
    // whatever the reverse cross-check placemark exposed.
    collectAcceptedPoiNames(forwardPoiName, confirmed) {
        const names = [];
        if (forwardPoiName) names.push(forwardPoiName);
        if (confirmed && Array.isArray(confirmed.poiNames)) {
            for (const name of confirmed.poiNames) {
                if (name) names.push(name);
            }
        }
        return names;
    }

    // Comparable token list for the POI ↔ bar comparison: lowercase,
    // punctuation → token breaks, leading "the" dropped — the same
    // normalization spirit as shared-core's findCuratedBarByName, kept
    // token-shaped so the generic-suffix rule can demand full-token alignment.
    tokenizePoiBarName(name) {
        const tokens = String(name || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .split(/\s+/)
            .filter(Boolean);
        if (tokens.length > 1 && tokens[0] === 'the') tokens.shift();
        return tokens;
    }

    // Trailing generic-venue word(s) dropped for matching, only when a
    // non-empty remainder is left ("night club" is the one two-token form).
    stripGenericVenueSuffix(tokens) {
        if (tokens.length >= 3 && tokens[tokens.length - 2] === 'night' && tokens[tokens.length - 1] === 'club') {
            return tokens.slice(0, -2);
        }
        if (tokens.length >= 2 && GEOCODE_GENERIC_VENUE_SUFFIXES.includes(tokens[tokens.length - 1])) {
            return tokens.slice(0, -1);
        }
        return tokens;
    }

    // Full-name equality after normalization, with the generic venue suffix
    // stripped symmetrically: "Massive" ↔ "Massive Nightclub" match because
    // the stripped remainder equals the other side exactly; "Eagle" ↔ "Eagle
    // Creek Cafe" never match (no substring/prefix matching).
    poiNameMatchesBar(poiName, barName) {
        const poiTokens = this.tokenizePoiBarName(poiName);
        const barTokens = this.tokenizePoiBarName(barName);
        if (poiTokens.length === 0 || barTokens.length === 0) return false;
        const poiFull = poiTokens.join('');
        const barFull = barTokens.join('');
        if (poiFull === barFull) return true;
        const poiStripped = this.stripGenericVenueSuffix(poiTokens).join('');
        const barStripped = this.stripGenericVenueSuffix(barTokens).join('');
        return poiStripped === barFull || poiFull === barStripped || poiStripped === barStripped;
    }

    // Street address assembled from a Nominatim result's addressdetails
    // components: house number + road, then locality (city/town/village/
    // municipality), then state when present. Returns '' when the details name
    // no road — a POI without a street line is not adoptable address material.
    assembleNominatimPoiAddress(result) {
        const details = result && typeof result.address === 'object' && result.address ? result.address : {};
        const clean = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
        const road = clean(details.road);
        if (!road) return '';
        const houseNumber = clean(details.house_number);
        const streetLine = houseNumber ? `${houseNumber} ${road}` : road;
        const locality = clean(details.city) || clean(details.town) || clean(details.village) || clean(details.municipality);
        return [streetLine, locality, clean(details.state)].filter(Boolean).join(', ');
    }

    // Photon flavor of the same assembly: street/housenumber/city properties.
    assemblePhotonPoiAddress(props) {
        const clean = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
        const street = clean(props && props.street);
        if (!street) return '';
        const houseNumber = clean(props && props.housenumber);
        const streetLine = houseNumber ? `${houseNumber} ${street}` : street;
        return [streetLine, clean(props && props.city)].filter(Boolean).join(', ');
    }

    // In-range venue-rescue candidates ordered nearest-first. Mirrors
    // pickNearestGeocodeCandidate's distance rule when the city has known
    // center coordinates; otherwise the textual city check applies and the
    // response order is kept. Input entries are { result, grade } pairs that
    // already passed the grade gate (coarse candidates never reach here).
    rankVenueRescueCandidates(gradedEntries, cityCenter, eventCity) {
        const ranked = [];
        for (const entry of Array.isArray(gradedEntries) ? gradedEntries : []) {
            if (!entry || !entry.result) continue;
            const lat = Number(entry.result.lat);
            const lon = Number(entry.result.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            if (cityCenter) {
                const distanceKm = this.haversineDistanceKm(lat, lon, cityCenter.lat, cityCenter.lng);
                if (distanceKm > CITY_CENTER_RADIUS_KM) continue;
                ranked.push({ result: entry.result, grade: entry.grade, distanceKm });
            } else {
                if (eventCity && !this.geocodeResultMatchesCity(entry.result, eventCity)) continue;
                ranked.push({ result: entry.result, grade: entry.grade, distanceKm: 0 });
            }
        }
        ranked.sort((a, b) => a.distanceKm - b.distanceKm);
        return ranked;
    }

    // Venue-POI adoption pick (Part of the venue+city rescue rung): the
    // nearest in-range candidate whose map POI name MATCHES the bar
    // (poiNameMatchesBar — full-name equality with symmetric generic-suffix
    // stripping, never prefix/substring). Returns { candidate, result,
    // poiName } or null. Generic/administrative hits can never reach here —
    // the grade gate already refused them as coarse.
    findVenuePoiAdoption(rankedEntries, barName) {
        const bar = typeof barName === 'string' ? barName.trim() : '';
        if (!bar) return null;
        for (const entry of Array.isArray(rankedEntries) ? rankedEntries : []) {
            const poiName = this.extractNominatimPoiName(entry.result);
            if (poiName && this.poiNameMatchesBar(poiName, bar)) {
                return {
                    candidate: { lat: entry.result.lat, lon: entry.result.lon, grade: entry.grade },
                    result: entry.result,
                    poiName
                };
            }
        }
        return null;
    }

    // Venue-name fusion detection (flag-only, run 20260723-140457: the flyer
    // listed the venues AQUA and EMPORIO on adjacent lines and extraction
    // fused them into bar "Aqua Emporio" — a venue that does not exist, while
    // the map knows "Aqua Club" ~40 m from the pin). When the FULL bar name
    // fails POI matching but a token PREFIX of it (first 1..n-1 whitespace
    // tokens, ≥3 chars, longest first) matches a returned POI name under the
    // same poiNameMatchesBar semantics, flag it for manual review — NO
    // auto-correction, and only candidates from queries ALREADY made are
    // consulted (zero extra requests). Single-token bars never flag; a
    // full-name match never flags. Fires at most once per event (flags) and
    // records `_geoPoiFusion` for the results-UI evidence panel.
    maybeFlagVenueNameFusion(event, poiNames, flags) {
        if (!event || typeof event !== 'object') return;
        if (flags && flags.fusionFlagged) return;
        const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
        if (!bar) return;
        const barTokens = bar.split(/\s+/).filter(Boolean);
        if (barTokens.length < 2) return;
        const names = [];
        for (const name of Array.isArray(poiNames) ? poiNames : []) {
            const cleanName = typeof name === 'string' ? name.trim() : '';
            if (cleanName && !names.includes(cleanName)) names.push(cleanName);
        }
        if (names.length === 0) return;
        if (names.some(name => this.poiNameMatchesBar(name, bar))) return;
        for (let count = barTokens.length - 1; count >= 1; count -= 1) {
            const prefix = barTokens.slice(0, count).join(' ');
            if (prefix.replace(/[^A-Za-z0-9]/g, '').length < 3) continue;
            const matchedName = names.find(name => this.poiNameMatchesBar(name, prefix));
            if (matchedName) {
                if (flags) flags.fusionFlagged = true;
                event._geoPoiFusion = { poi: matchedName, prefix };
                const title = event.title || 'unknown';
                console.warn(`🗺️ GEOCODE VERIFY: "${title}" bar "${bar}" may fuse multiple venue names — map knows "${matchedName}" (matches "${prefix}"); verify manually`);
                return;
            }
        }
    }

    // After a pin is accepted, map POI names vouch for the event's bar:
    //   match → an unstamped or `uncorroborated` bar upgrades to
    //           barSource 'geo-poi'; the equal-or-higher-trust stamps
    //           (curated/venue-site/page-adjacent) are NEVER overwritten;
    //   POI present but ≠ an `uncorroborated` bar → log-only mismatch flag
    //           (flag-don't-drop);
    //   no POI / no bar → nothing (fail open).
    corroborateBarWithGeoPoi(event, poiNames) {
        if (!event || typeof event !== 'object') return;
        const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
        const names = [];
        for (const name of Array.isArray(poiNames) ? poiNames : []) {
            const cleanName = typeof name === 'string' ? name.trim() : '';
            if (cleanName && !names.includes(cleanName)) names.push(cleanName);
        }
        if (!bar || names.length === 0) return;
        const title = event.title || 'unknown';
        const stamp = typeof event.barSource === 'string' ? event.barSource.trim() : '';
        const matched = names.find(name => this.poiNameMatchesBar(name, bar));
        if (matched) {
            if (!stamp || stamp === 'uncorroborated') {
                event.barSource = 'geo-poi';
            }
            console.log(`🗺️ GEOCODE VERIFY: "${title}" bar "${bar}" corroborated by map POI "${matched}"`);
            return;
        }
        if (stamp === 'uncorroborated') {
            console.warn(`🗺️ GEOCODE VERIFY: "${title}" address POI is "${names[0]}" but bar is "${bar}" — possible venue-name mismatch`);
        }
    }

    // Vetoed adoption fallback: when a venue-POI adoption's PIN is refused by
    // the reverse cross-check (or the skipped-≠-pass rule), the adopted
    // ADDRESS must not be discarded with it — the POI-name match already
    // vouches for the address text (it IS the map's own record of the venue),
    // while the veto only disputes the coordinates. Keep the address, stamped
    // geo-poi and flagged for manual review, and leave the event unpinned
    // (flag-don't-drop; run 20260723-152928 left "FURBALL Boston" with
    // neither address nor pin). Returns true when the event was modified.
    keepAdoptedAddressWithoutPin(event, adoption, title) {
        if (!adoption || !adoption.address) return false;
        if (event.address === adoption.address && event.addressSource === 'geo-poi') return false;
        event.address = adoption.address;
        event.addressSource = 'geo-poi';
        console.warn(`🗺️ GEOCODE VERIFY: "${title}" POI-adopted address "${adoption.address}" kept without pin — reverse cross-check refused the pin (verify manually)`);
        return true;
    }

    // Final acceptance for a grade-gate-passing candidate: reverse cross-check
    // against the input address (Apple placemark via the adapter, when that
    // capability exists) plus suspect flagging per verification mode. Returns
    // { location, crossCheck, poiNames } — the "lat, lon" string to write, the
    // cross-check verdict ('pass' | 'fail' | 'skipped'; 'fail' only survives
    // in report mode), and any POI names harvested from the reverse placemark
    // the cross-check already fetched (geo-POI bar corroboration; empty when
    // no placemark or no name) — or, when enforce mode sends the ladder on to
    // its next rung, { location: null, crossCheck } carrying the rejection
    // breadcrumb ('fail' for a failed cross-check, 'skipped' for a vague
    // input or an unavailable cross-check).
    async confirmGeocodeCandidate(candidate, context, httpAdapter) {
        const { title, address, inputHasHouseNumber, verifyMode, streetSpecific, flags, source, rung, poiAdopted } = context;
        // Vague-input rule (enforce only): an address without street-level
        // detail ("Poconos, PA") asks a question no geocoder can answer
        // precisely — whatever came back is an arbitrary same-named candidate.
        // Refuse it before spending cross-check budget; the flag fires once
        // per event, not per rung. Curated venues never get here — the
        // BarDataNormalizer runs before geocoding in the pipeline.
        if (verifyMode === 'enforce' && streetSpecific === false) {
            if (flags && !flags.vagueInputFlagged) {
                flags.vagueInputFlagged = true;
                console.warn(`🗺️ GEOCODE VERIFY: "${title}" address too vague for a trustworthy pin — left unpinned (enforce)`);
            }
            return { location: null, crossCheck: 'skipped' };
        }
        let crossCheck = 'skipped';
        let poiNames = [];
        if (verifyMode !== 'off' && typeof httpAdapter.reverseGeocodePlacemark === 'function') {
            let placemark = null;
            try {
                placemark = await httpAdapter.reverseGeocodePlacemark(Number(candidate.lat), Number(candidate.lon));
            } catch (err) {
                placemark = null;
            }
            if (placemark) {
                // Geo-POI harvest from the SAME placemark the cross-check
                // fetched — no additional reverse-geocode call.
                poiNames = this.extractPlacemarkPoiNames(placemark);
                const comparison = this.comparePinToAddress(placemark, address);
                if (comparison) {
                    let matched = comparison.matched;
                    // POI-adopted pins only (the venue-POI adoption path —
                    // addressSource 'geo-poi'): the adopted address and the
                    // pin come from the SAME map object, so a reverse
                    // placemark naming the SAME street with a nearby house
                    // number is two providers interpolating one building, not
                    // a wrong pin (run 20260723-152928: "75 Warrenton St" vs
                    // adopted "79 Warrenton Street" vetoed the adoption).
                    // Different street name, or a gap over the tolerance,
                    // still refuses exactly as today — as do all
                    // non-POI-adopted pins.
                    if (!matched && poiAdopted === true && comparison.streetMatched === true
                        && comparison.pinHouse && comparison.inputHouse) {
                        const pinHouseNumber = parseInt(comparison.pinHouse, 10);
                        const inputHouseNumber = parseInt(comparison.inputHouse, 10);
                        if (Number.isFinite(pinHouseNumber) && Number.isFinite(inputHouseNumber)
                            && Math.abs(pinHouseNumber - inputHouseNumber) <= POI_PIN_HOUSE_NUMBER_TOLERANCE) {
                            matched = true;
                            console.log(`🗺️ GEOCODE VERIFY: "${title}" POI pin reverse check: same street, house ${comparison.pinHouse} vs ${comparison.inputHouse} — accepted (provider interpolation tolerance)`);
                        }
                    }
                    crossCheck = matched ? 'pass' : 'fail';
                    if (!matched) {
                        console.warn(`🗺️ GEOCODE VERIFY: "${title}" pin failed reverse cross-check ("${comparison.got}" vs "${address}") — verify pin`);
                        if (verifyMode === 'enforce') return { location: null, crossCheck: 'fail' };
                    }
                }
            }
        }
        // Skipped ≠ pass rule (enforce only): when the platform CAN reverse
        // geocode (adapter self-description via supportsReverseGeocode) but
        // the cross-check produced no comparison (Apple rate-limited/down, no
        // placemark, nothing comparable), the candidate is rejected — the
        // 2026-07-16 run showed 'skipped' silently removing the whole safety
        // layer. Structural absence of the capability (Node/web) is not a
        // failure and accepts exactly as before. Flag once per event.
        if (crossCheck === 'skipped' && verifyMode === 'enforce' &&
            typeof httpAdapter.supportsReverseGeocode === 'function' &&
            httpAdapter.supportsReverseGeocode() === true) {
            if (flags && !flags.crossCheckUnavailableFlagged) {
                flags.crossCheckUnavailableFlagged = true;
                console.warn(`🗺️ GEOCODE VERIFY: "${title}" pin rejected — cross-check unavailable (enforce)`);
            }
            return { location: null, crossCheck: 'skipped' };
        }
        if (candidate.grade === 'street' && inputHasHouseNumber && verifyMode === 'report') {
            console.warn(`🗺️ GEOCODE VERIFY: "${title}" street-grade pin for house-numbered address "${address}" — verify pin`);
        }
        if (streetSpecific === false && verifyMode === 'report') {
            // Report mode accepts the pin (flag-don't-drop: a flagged pin
            // beats no pin on a brand-new event) but makes the vagueness
            // visible.
            console.warn(`🗺️ GEOCODE VERIFY: "${title}" pin from vague address "${address}" — verify pin`);
        }
        if (rung > 1 || crossCheck !== 'skipped') {
            console.log(`🗺️ GEOCODE VERIFY: "${title}" accepted ${candidate.grade} pin from ${source} (rung ${rung})`);
        }
        return { location: `${candidate.lat}, ${candidate.lon}`, crossCheck, poiNames };
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

    // US-ish gate for the Census rescue rung: a 5-digit ZIP anywhere in the
    // address, or a two-letter state token after a comma at the tail
    // (optionally followed by a USA/US/United States segment). The gate only
    // needs to be roughly right — a false positive just sends one query the
    // Census geocoder answers with no match.
    looksLikeUsAddress(address) {
        const text = String(address || '').trim();
        if (/\b\d{5}(?:-\d{4})?\b/.test(text)) return true;
        return /,\s*[A-Za-z]{2}\.?\s*(?:,\s*(?:USA|US|United States)\s*)?$/i.test(text);
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

    // Display-name anchor for outbound geocode queries. Internal city keys are
    // meaningless to geocoders ("1123 Folsom Street, sf", "Palm Springs,
    // palm-springs", "1200 Canal St, nola" all confuse Nominatim's free-text
    // parser), so anchor with the city's first configured pattern (e.g. nyc →
    // "new york"), falling back to the key itself when the config carries
    // none. Only QUERY strings use this — city-center radius lookups and
    // geocodeResultMatchesCity keep using the raw key.
    geocodeCityAnchorName(cityKey) {
        const key = String(cityKey || '').trim();
        if (!key || !this.core || !this.core.cities) return key;
        const cityConfig = this.core.cities[key] || this.core.cities[this.foldDiacritics(key)];
        const patterns = cityConfig && Array.isArray(cityConfig.patterns) ? cityConfig.patterns : [];
        const displayName = typeof patterns[0] === 'string' ? patterns[0].trim() : '';
        return displayName || key;
    }

    // Forward-geocode retry ladder: deduped, ordered query strings, hard-capped
    // at MAX_GEOCODE_QUERIES_PER_EVENT. Order:
    //   1. "<bar>, <address>" — the venue name IN FRONT of its own address.
    //      Measured against verified truth: "Victoria Embankment, London, UK"
    //      (the address dice.fm publishes for Westminster Pier) resolves to a
    //      point 1075 m away — the wrong pier — while "Westminster Pier,
    //      Victoria Embankment, London, UK" resolves to 1 m. The name is the
    //      disambiguator for a vague street line. It is FIRST, not universal:
    //      the extra token over-constrains some queries (Horizon, Eden both
    //      return NOTHING with the name attached and resolve fine without it),
    //      which is exactly why the address-only rungs below still run.
    //   2. The query exactly as built before (anchored to the city display name
    //      when the address doesn't already contain it).
    //   3. The address with unit/suite tokens stripped (same anchoring) —
    //      "Suite 200" / "#4" decoration returns 0 results.
    //   4. The address with postal-code/country decoration stripped (same
    //      anchoring) — Nominatim chokes on "…, CA 94103, USA" endings.
    //   5. The address with trailing directionals stripped (same anchoring) —
    //      Nominatim's free-text parser chokes on "Rd NE" / "Road Northeast".
    //   6. "<bar>, <city>" — venue-name lookup rescues venues OSM knows by name.
    buildGeocodeQueryVariants(address, eventCity, bar) {
        const city = this.geocodeCityAnchorName(typeof eventCity === 'string' ? eventCity.trim() : '');
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

        // Address-derived rungs only exist when there IS an address — a
        // no-address event (venue-POI rescue) must not emit a junk ", <city>"
        // query; its ladder is the venue+city rescue rung alone.
        const baseAddress = String(address || '').trim();
        const leadingBarName = typeof bar === 'string' ? bar.trim() : '';
        if (baseAddress) {
            // Name-led rung first (only when the address doesn't already start
            // with the venue name — ticketing pages sometimes publish it that
            // way, and a doubled name is a query nothing matches).
            if (leadingBarName && !baseAddress.toLowerCase().startsWith(leadingBarName.toLowerCase())) {
                push(anchorToCity(`${leadingBarName}, ${baseAddress}`));
            }
            push(anchorToCity(baseAddress));
            const unitStripped = this.stripUnitTokens(baseAddress);
            if (unitStripped && unitStripped !== baseAddress) push(anchorToCity(unitStripped));
            const postalStripped = this.stripPostalCodeAndCountry(baseAddress);
            if (postalStripped) push(anchorToCity(postalStripped));
            push(anchorToCity(this.stripTrailingDirectionals(baseAddress)));
        }
        const barName = typeof bar === 'string' ? bar.trim() : '';
        if (barName && city) {
            push(`${barName}, ${city}`);
        }

        return variants.slice(0, MAX_GEOCODE_QUERIES_PER_EVENT);
    }

    async normalizeAsync(event, httpAdapter, pipelineOptions = {}) {
        if (!event || !httpAdapter || typeof httpAdapter.fetchData !== 'function') return event;

        const hasAddress = typeof event.address === 'string' && event.address.trim().length > 0;
        const hasLocation = typeof event.location === 'string' && event.location.trim().length > 0 && event.location.includes(',');

        // Pin verification knob (config.geocodeVerification.mode). The coarse
        // grade gate is data correctness and stays active in every mode — the
        // knob only governs the reverse cross-check and suspect handling.
        const verification = pipelineOptions && pipelineOptions.geocodeVerification && typeof pipelineOptions.geocodeVerification === 'object'
            ? pipelineOptions.geocodeVerification
            : {};
        const verifyMode = verification.mode === 'off' || verification.mode === 'enforce' ? verification.mode : 'report';

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

        // Venue-POI rescue eligibility: an event with a bar but NO usable
        // address (missing entirely, dropped by the extraction plausibility
        // gate, or refused as generic by every rung below) can still earn a
        // pin AND a street address from the venue+city lookup — but ONLY when
        // the hit's map POI name matches the bar (see findVenuePoiAdoption).
        const rescueBarName = typeof event.bar === 'string' ? event.bar.trim() : '';
        if (!hasLocation && (hasAddress || rescueBarName)) {
            const address = hasAddress ? event.address.trim() : '';
            // Bare street strings geocode anywhere on the planet: a flyer-OCR typo like
            // "922 E. BURNSIDE" (real address: 722 E Burnside, Portland) resolved to
            // Burnside, Michigan. When the event knows its city, anchor the query to it.
            // When the city also has known center coordinates, request several
            // candidates and pick by distance to that center (textual matching alone
            // false-accepts "Portland, Michigan" for a Portland OR event); otherwise
            // fall back to rejecting results whose address details don't mention the city.
            const eventCity = typeof event.city === 'string' ? event.city.trim() : '';
            const cityCenter = this.getCityCenterCoordinates(eventCity);
            const resultLimit = cityCenter ? 5 : 1;
            const title = event.title || 'unknown';
            const inputHasHouseNumber = GEOCODE_HOUSE_NUMBER_RE.test(address);
            const streetSpecific = this.isStreetSpecificAddress(address);
            // The venue+city rescue query exactly as buildGeocodeQueryVariants
            // builds it — used to recognize the venue-rescue rung inside the
            // ladder and as the Photon query when the event has no address.
            const cityAnchor = this.geocodeCityAnchorName(eventCity);
            const venueRescueQuery = rescueBarName && cityAnchor ? `${rescueBarName}, ${cityAnchor}` : '';
            // Address adoption is only allowed when the event has no usable
            // street-specific address of its own (missing/gate-dropped/vague).
            const addressAdoptable = !address || !this.isStreetSpecificAddress(address);
            // flags carries the once-per-event verification flag lines across
            // ladder rungs (the per-rung spreads copy this same object reference).
            const verifyContext = { title, address, inputHasHouseNumber, verifyMode, streetSpecific, flags: {} };

            // Retry ladder: when a query returns 0 candidates (or every candidate
            // is rejected by the grade gate / distance / city checks), retry with
            // progressively simplified queries. Every attempt goes through
            // fetchDataWithCacheAndRateLimit (rate-limited AND cached) and the
            // ladder is hard-capped at MAX_GEOCODE_QUERIES_PER_EVENT requests.
            const queryVariants = this.buildGeocodeQueryVariants(address, eventCity, event.bar);
            let attempts = 0;
            let resolvedLocation = null;
            // Verdict of the accepted pin ({grade, crossCheck, source, rung}),
            // committed to the event's _geocode* metadata fields below. When the
            // ladder ends UNPINNED, rejectedVerdict remembers the first candidate
            // enforce mode turned away (street-grade for a house-numbered input,
            // a cross-check failure, a vague input, or an unavailable
            // cross-check) so the calendar reviewer can tell "this
            // address only resolves to an unverifiable pin" apart from "nothing
            // resolves at all". Coarse refusals never leave a breadcrumb.
            let resolvedVerdict = null;
            let rejectedVerdict = null;
            // POI names harvested from the responses that produced/verified the
            // accepted pin (geo-POI bar corroboration; empty when unpinned).
            let resolvedPoiNames = [];
            // Whether the Nominatim venue+city rescue rung produced ANY usable
            // (non-coarse, gate-passing) candidate. When it did not — the
            // venue simply isn't on OSM under that name — the Photon rescue
            // below additionally runs the venue+city query, whose fuzzy
            // matcher may still know the venue (adoption + fusion detection).
            let venueRescueNominatimUsable = false;
            for (let i = 0; i < queryVariants.length && !resolvedLocation; i++) {
                const queryText = queryVariants[i];
                const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryText)}&limit=${resultLimit}&addressdetails=1`;
                attempts += 1;
                try {
                    const data = await this.fetchDataWithCacheAndRateLimit(url, options, httpAdapter);
                    // Simplified/fallback queries can degrade to a bare place name and
                    // match the admin area itself — reject those centroids. The first
                    // (full-address) query relies on the grade gate below: a full
                    // address that resolves to an admin boundary is a coarse pin.
                    let candidates = Array.isArray(data) ? data : [];
                    if (i > 0 && candidates.length > 0) {
                        candidates = candidates.filter(result => {
                            if (!this.isAdminAreaGeocodeResult(result)) return true;
                            const kind = result.addresstype || result.type || 'unknown';
                            console.warn(`🗺️ OpenStreetMapNormalizer: Rejected admin-area result for "${queryText}" (type=${kind}) — not a venue/address`);
                            return false;
                        });
                    }
                    // Grade gate (all rungs, every mode): a coarse candidate never
                    // becomes a pin; street-grade candidates are dropped up front
                    // only when enforce mode demands house-number quality.
                    const graded = [];
                    for (const result of candidates) {
                        const grade = this.gradeNominatimResult(result);
                        if (grade === 'coarse') {
                            const kind = result.addresstype || result.type || 'unknown';
                            console.warn(`🗺️ GEOCODE VERIFY: "${title}" refused generic pin (${kind}) for address "${address}"`);
                            continue;
                        }
                        if (grade === 'street' && inputHasHouseNumber && verifyMode === 'enforce') {
                            if (!rejectedVerdict) {
                                rejectedVerdict = { grade: 'street', crossCheck: 'skipped', source: 'nominatim', rung: i + 1 };
                            }
                            continue;
                        }
                        graded.push({ result, grade });
                    }
                    const isVenueRescueRung = Boolean(venueRescueQuery) && queryText === venueRescueQuery;
                    if (isVenueRescueRung && graded.length > 0) venueRescueNominatimUsable = true;
                    if (graded.length > 0) {
                        // Venue-POI adoption scan (venue-rescue rung only): the
                        // nearest in-range hit whose map POI name MATCHES the
                        // bar vouches for pin AND address; a non-matching set
                        // of candidates instead feeds fusion detection.
                        let venuePoiPick = null;
                        if (isVenueRescueRung) {
                            const rankedVenueCandidates = this.rankVenueRescueCandidates(graded, cityCenter, eventCity);
                            venuePoiPick = this.findVenuePoiAdoption(rankedVenueCandidates, rescueBarName);
                            if (!venuePoiPick) {
                                this.maybeFlagVenueNameFusion(
                                    event,
                                    rankedVenueCandidates.map(entry => this.extractNominatimPoiName(entry.result)),
                                    verifyContext.flags
                                );
                            }
                        }
                        const adoption = venuePoiPick && addressAdoptable
                            ? { poiName: venuePoiPick.poiName, address: this.assembleNominatimPoiAddress(venuePoiPick.result) }
                            : null;
                        let pickedCandidate = null;
                        let pickedResult = null;
                        if (adoption) {
                            pickedCandidate = venuePoiPick.candidate;
                            pickedResult = venuePoiPick.result;
                        } else if (!hasAddress) {
                            // Venue-only lookup (no usable address at all):
                            // nothing vouches for a hit whose POI name is NOT
                            // the bar — never pin from it (today's no-address
                            // behavior, fail open).
                        } else if (cityCenter) {
                            // Distance-ranked selection: nearest candidate within the radius wins
                            const picked = this.pickNearestGeocodeCandidate(graded.map(entry => entry.result), cityCenter, eventCity, queryText);
                            if (picked) {
                                pickedCandidate = { lat: picked.lat, lon: picked.lon, grade: graded[picked.index].grade };
                                pickedResult = graded[picked.index].result;
                            }
                        } else {
                            const firstResult = graded[0].result;
                            if (firstResult.lat && firstResult.lon) {
                                if (eventCity && !this.geocodeResultMatchesCity(firstResult, eventCity)) {
                                    console.warn(`🗺️ OpenStreetMapNormalizer: Geocode for "${queryText}" resolved outside event city "${eventCity}" ("${firstResult.display_name || 'no display name'}") — ignoring coordinates`);
                                } else {
                                    pickedCandidate = { lat: firstResult.lat, lon: firstResult.lon, grade: graded[0].grade };
                                    pickedResult = firstResult;
                                }
                            }
                        }
                        if (pickedCandidate) {
                            // Adoption context: the POI-name match IS the
                            // positive verification for this candidate, and
                            // the address the cross-check compares against is
                            // the one assembled from the hit itself — the
                            // vague-input rule must not refuse what the map
                            // just positively named (streetSpecific: true).
                            const confirmContext = adoption
                                ? { ...verifyContext, address: adoption.address || address, streetSpecific: true, poiAdopted: true, source: 'nominatim', rung: i + 1 }
                                : { ...verifyContext, source: 'nominatim', rung: i + 1 };
                            const confirmed = await this.confirmGeocodeCandidate(pickedCandidate, confirmContext, httpAdapter);
                            if (confirmed.location) {
                                resolvedLocation = confirmed.location;
                                resolvedVerdict = { grade: pickedCandidate.grade, crossCheck: confirmed.crossCheck, source: 'nominatim', rung: i + 1 };
                                resolvedPoiNames = this.collectAcceptedPoiNames(
                                    adoption
                                        ? venuePoiPick.poiName
                                        : (pickedCandidate.grade === 'exact' ? this.extractNominatimPoiName(pickedResult) : ''),
                                    confirmed
                                );
                                if (adoption && adoption.address) {
                                    event.address = adoption.address;
                                    event.addressSource = 'geo-poi';
                                    modified = true;
                                    console.log(`🗺️ GEOCODE VERIFY: "${title}" adopted address "${adoption.address}" from map POI "${venuePoiPick.poiName}" (venue+city lookup)`);
                                }
                            } else {
                                // Vetoed adoption: the pin is refused but the
                                // POI-vouched address survives, unpinned and
                                // flagged (see keepAdoptedAddressWithoutPin).
                                if (adoption && this.keepAdoptedAddressWithoutPin(event, adoption, title)) {
                                    modified = true;
                                }
                                if (!rejectedVerdict) {
                                    // enforce-mode rejection: 'fail' for a failed
                                    // cross-check, 'skipped' for a vague input or
                                    // an unavailable cross-check
                                    rejectedVerdict = { grade: pickedCandidate.grade, crossCheck: confirmed.crossCheck, source: 'nominatim', rung: i + 1 };
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
                    // The query string that actually produced the pin.
                    // Underscore = metadata only (excluded from notes/merge
                    // loops). The maps-link rung reads it: a pin from a query
                    // carrying no street line is a name/city guess, however
                    // confident the response looked.
                    event._geocodeQuery = queryText;
                    // Did this query carry the event's ADDRESS, or was it the
                    // bare "<venue>, <city>" rescue? The maps-link rung below
                    // only outranks the latter.
                    event._geocodeQueryHadAddress = hasAddress && queryText !== venueRescueQuery;
                    modified = true;
                    console.log(`🗺️ OpenStreetMapNormalizer: Found coordinates for address "${event.address}" -> ${event.location}`);
                    if (i > 0) {
                        console.log(`🗺️ OpenStreetMapNormalizer: Geocoded via simplified query "${queryText}"`);
                    }
                }
            }
            if (!resolvedLocation && this.looksLikeUsAddress(address)) {
                // US Census rescue rung: free, no key, house-number-accurate for
                // US addresses (TIGER interpolation), tried BEFORE Photon when
                // every Nominatim rung failed or was rejected. Gated on the
                // address looking US-ish — a miss just returns no match. Same
                // rate limiter, same caches. Coordinates come back {x: lon, y: lat}.
                const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
                attempts += 1;
                try {
                    const data = await this.fetchDataWithCacheAndRateLimit(censusUrl, options, httpAdapter);
                    const matches = data && data.result && Array.isArray(data.result.addressMatches)
                        ? data.result.addressMatches
                        : [];
                    const match = matches.length > 0 ? matches[0] : null;
                    const coords = match && match.coordinates && typeof match.coordinates === 'object' ? match.coordinates : null;
                    const lon = coords ? Number(coords.x) : NaN;
                    const lat = coords ? Number(coords.y) : NaN;
                    if (Number.isFinite(lat) && Number.isFinite(lon)) {
                        const withinRadius = !cityCenter ||
                            this.haversineDistanceKm(lat, lon, cityCenter.lat, cityCenter.lng) <= CITY_CENTER_RADIUS_KM;
                        if (withinRadius) {
                            // A Census match is a house-number interpolation → grade
                            // 'exact'; it still has to survive the reverse cross-check
                            // like any other pin.
                            const confirmed = await this.confirmGeocodeCandidate(
                                { lat, lon, grade: 'exact' },
                                { ...verifyContext, source: 'census', rung: attempts },
                                httpAdapter
                            );
                            if (confirmed.location) {
                                resolvedLocation = confirmed.location;
                                resolvedVerdict = { grade: 'exact', crossCheck: confirmed.crossCheck, source: 'census', rung: attempts };
                                // Census names no POIs (address interpolation
                                // only) — harvest just the cross-check side.
                                resolvedPoiNames = this.collectAcceptedPoiNames('', confirmed);
                            } else if (!rejectedVerdict) {
                                rejectedVerdict = { grade: 'exact', crossCheck: confirmed.crossCheck, source: 'census', rung: attempts };
                            }
                        } else {
                            console.warn(`🗺️ OpenStreetMapNormalizer: Census match for "${address}" falls outside ${CITY_CENTER_RADIUS_KM} km of ${eventCity} center — ignoring coordinates`);
                        }
                    } else {
                        console.log(`🗺️ OpenStreetMapNormalizer: Census geocoder had no match for "${address}"`);
                    }
                } catch (err) {
                    console.log(`🗺️ OpenStreetMapNormalizer: Failed to geocode address "${event.address}": ${err.message}`);
                }
                if (resolvedLocation) {
                    event.location = resolvedLocation;
                    event._geocodeQuery = address; // Census only ever queries the street address
                    event._geocodeQueryHadAddress = true;
                    modified = true;
                    console.log(`🗺️ OpenStreetMapNormalizer: Found coordinates for address "${event.address}" -> ${event.location}`);
                }
            }
            if (!resolvedLocation && (hasAddress || venueRescueQuery)) {
                // Photon rescue rung: a second geocoder with a friendlier free-text
                // parser, tried once after every Nominatim rung (and the Census
                // rescue, when eligible) failed. Same rate limiter, same caches.
                // GeoJSON coordinates are [lon, lat]. Events with NO usable
                // address query the venue+city string instead — pin/address may
                // then only be adopted from a hit whose POI name matches the bar.
                const photonQueries = [hasAddress ? address : venueRescueQuery];
                // Venue-name follow-up (run 20260723-152928: bar "AQUA
                // EMPORIO" — Nominatim's venue+city rescue knew nothing, the
                // Photon rescue only queried the address, and the fusion
                // check never saw Photon's "Aqua Club"): when the event HAS
                // an address (so the primary Photon query above is that
                // address) and the Nominatim venue+city rescue produced no
                // usable candidate, additionally run the SAME venue+city
                // query through Photon — its fuzzy matcher is the last
                // source that can still name the venue for adoption/fusion
                // detection. Existing request type, same rate limiter and
                // caches; only runs while the event is still unpinned.
                if (hasAddress && venueRescueQuery && !venueRescueNominatimUsable) {
                    photonQueries.push(venueRescueQuery);
                }
                for (const photonQuery of photonQueries) {
                    if (resolvedLocation) break;
                    // The venue-name follow-up may only pin via adoption: like the
                    // no-address venue lookup, nothing vouches for a venue-query
                    // hit whose POI name is NOT the bar (the event's own address
                    // rungs already had their chance to pin).
                    const isVenueFollowUpQuery = hasAddress && Boolean(venueRescueQuery) && photonQuery === venueRescueQuery;
                    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(photonQuery)}&limit=1`;
                    attempts += 1;
                    try {
                        const data = await this.fetchDataWithCacheAndRateLimit(photonUrl, options, httpAdapter);
                        const feature = data && Array.isArray(data.features) && data.features.length > 0 ? data.features[0] : null;
                        const coords = feature && feature.geometry && Array.isArray(feature.geometry.coordinates)
                            ? feature.geometry.coordinates
                            : null;
                        const lon = coords ? Number(coords[0]) : NaN;
                        const lat = coords ? Number(coords[1]) : NaN;
                        if (Number.isFinite(lat) && Number.isFinite(lon)) {
                            const props = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
                            const grade = this.classifyGeocodeGrade(props.osm_key, props.osm_value, props.osm_value, !!props.housenumber);
                            const withinRadius = !cityCenter ||
                                this.haversineDistanceKm(lat, lon, cityCenter.lat, cityCenter.lng) <= CITY_CENTER_RADIUS_KM;
                            const photonPoiName = this.extractNominatimPoiName({ name: props.name });
                            const photonPoiMatchesBar = Boolean(photonPoiName && rescueBarName
                                && this.poiNameMatchesBar(photonPoiName, rescueBarName));
                            const adoption = photonPoiMatchesBar && addressAdoptable && withinRadius && grade !== 'coarse'
                                ? { poiName: photonPoiName, address: this.assemblePhotonPoiAddress(props) }
                                : null;
                            if (grade === 'coarse') {
                                console.warn(`🗺️ GEOCODE VERIFY: "${title}" refused generic pin (${props.osm_value || 'unknown'}) for address "${address}"`);
                            } else if ((!hasAddress || isVenueFollowUpQuery) && !adoption) {
                                // Venue-only lookup (and the venue-name follow-up):
                                // a hit whose POI name is NOT the bar has nothing
                                // vouching for it — never pin (fail open).
                            } else if (grade === 'street' && inputHasHouseNumber && verifyMode === 'enforce') {
                                // enforce demands house-number quality; stay unpinned
                                if (!rejectedVerdict) {
                                    rejectedVerdict = { grade: 'street', crossCheck: 'skipped', source: 'photon', rung: attempts };
                                }
                            } else if (withinRadius) {
                                // Adoption context mirrors the Nominatim venue rung:
                                // the POI-name match is the positive verification.
                                const confirmContext = adoption
                                    ? { ...verifyContext, address: adoption.address || address, streetSpecific: true, poiAdopted: true, source: 'photon', rung: attempts }
                                    : { ...verifyContext, source: 'photon', rung: attempts };
                                const confirmed = await this.confirmGeocodeCandidate(
                                    { lat: coords[1], lon: coords[0], grade },
                                    confirmContext,
                                    httpAdapter
                                );
                                if (confirmed.location) {
                                    resolvedLocation = confirmed.location;
                                    resolvedVerdict = { grade, crossCheck: confirmed.crossCheck, source: 'photon', rung: attempts };
                                    resolvedPoiNames = this.collectAcceptedPoiNames(
                                        adoption
                                            ? adoption.poiName
                                            : (grade === 'exact' ? this.extractNominatimPoiName({ name: props.name }) : ''),
                                        confirmed
                                    );
                                    if (adoption && adoption.address) {
                                        event.address = adoption.address;
                                        event.addressSource = 'geo-poi';
                                        modified = true;
                                        console.log(`🗺️ GEOCODE VERIFY: "${title}" adopted address "${adoption.address}" from map POI "${adoption.poiName}" (venue+city lookup)`);
                                    }
                                } else {
                                    // Vetoed adoption: keep the POI-vouched
                                    // address, unpinned and flagged (see
                                    // keepAdoptedAddressWithoutPin).
                                    if (adoption && this.keepAdoptedAddressWithoutPin(event, adoption, title)) {
                                        modified = true;
                                    }
                                    if (!rejectedVerdict) {
                                        rejectedVerdict = { grade, crossCheck: confirmed.crossCheck, source: 'photon', rung: attempts };
                                    }
                                }
                            }
                            // Fusion detection (flag-only) on the candidate this
                            // already-made query returned: a non-generic POI that
                            // matches only a PREFIX of the bar name suggests the
                            // bar fused multiple venue names.
                            if (photonPoiName && !photonPoiMatchesBar && grade !== 'coarse') {
                                this.maybeFlagVenueNameFusion(event, [photonPoiName], verifyContext.flags);
                            }
                        }
                    } catch (err) {
                        console.log(`🗺️ OpenStreetMapNormalizer: Failed to geocode address "${event.address}": ${err.message}`);
                    }
                    if (resolvedLocation) {
                        event.location = resolvedLocation;
                        event._geocodeQuery = photonQuery;
                        event._geocodeQueryHadAddress = hasAddress && photonQuery !== venueRescueQuery;
                        modified = true;
                        console.log(`🗺️ OpenStreetMapNormalizer: Found coordinates for address "${event.address}" -> ${event.location}`);
                    }
                }
            }
            // Geocode verdict metadata for downstream consumers (the calendar
            // reviewer's proposal gate). Underscore-prefixed fields are
            // systematically excluded from notes/merge output. An unpinned event
            // carries the breadcrumb of the best rejected candidate, when any.
            const verdict = resolvedLocation ? resolvedVerdict : rejectedVerdict;
            if (verdict) {
                event._geocodeGrade = verdict.grade;
                event._geocodeCrossCheck = verdict.crossCheck;
                event._geocodeSource = verdict.source;
                event._geocodeRung = verdict.rung;
            }
            if (resolvedLocation) {
                // Provenance for the forward-geocoded pin: an exact grade whose
                // reverse cross-check did not fail is our best pin
                // (geocoded-exact). Everything else — street/photon/census-grade
                // or a failed cross-check — is only approximate (geocoded-approx).
                event.pinSource = (resolvedVerdict && resolvedVerdict.grade === 'exact' && resolvedVerdict.crossCheck !== 'fail')
                    ? 'geocoded-exact'
                    : 'geocoded-approx';
                // Retain the harvested map POI name for the results-UI evidence
                // panel (underscore fields — display-only, systematically
                // excluded from notes/merge serialization; only set when THIS
                // run harvested a POI, so cached/skipped geocodes add nothing).
                // The bar-match verdict is computed here, where the existing
                // poiNameMatchesBar lives, preferring a bar-matching name over
                // the first harvested one.
                if (resolvedPoiNames.length > 0) {
                    const poiBar = typeof event.bar === 'string' ? event.bar.trim() : '';
                    const matchedPoiName = poiBar
                        ? resolvedPoiNames.find(name => this.poiNameMatchesBar(name, poiBar))
                        : undefined;
                    event._geoPoiName = matchedPoiName || resolvedPoiNames[0];
                    if (poiBar) event._geoPoiBarMatch = Boolean(matchedPoiName);
                }
                // Geo-POI bar corroboration: the map names harvested from the
                // accepted pin's own responses vouch for (or question) the bar.
                this.corroborateBarWithGeoPoi(event, resolvedPoiNames);
            }
            if (!resolvedLocation && hasAddress) {
                // Exact shape counted by run-log-summary's geocodeNoResults
                // guard. Only address-bearing events emit it — the no-address
                // venue-POI lookup never logged before and stays quiet when it
                // finds nothing adoptable.
                console.warn(`🗺️ OpenStreetMapNormalizer: No geocode results for "${address}" (${eventCity || 'no city'}) after ${attempts} ${attempts === 1 ? 'query' : 'queries'} — leaving location empty`);
                if (inputHasHouseNumber) {
                    console.warn(`🗺️ GEOCODE VERIFY: "${title}" full address but no usable geocoordinate — left unpinned`);
                }
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
                        // Reverse-geocoded from the pin — the address is inferred.
                        event.addressSource = 'inferred';
                        modified = true;
                        console.log(`🗺️ OpenStreetMapNormalizer: Found address for coordinates "${event.location}" -> ${event.address} (native reverse geocode)`);
                    } else {
                        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
                        try {
                            const data = await this.fetchDataWithCacheAndRateLimit(url, options, httpAdapter);
                            if (data && data.display_name) {
                                event.address = data.display_name;
                                // Reverse-geocoded from the pin — the address is inferred.
                                event.addressSource = 'inferred';
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

        // Last rung of the pin ladder: the page's own maps-link pin, used only
        // when curated data and the geocoder above both came up empty. Also
        // reports a disagreement when they didn't.
        if (this.applyMapsLinkCoordinateFallback(event)) modified = true;

        if (modified && this.core && typeof this.core.formatEventNotes === 'function') {
            event.notes = this.core.formatEventNotes(event);
        }

        return event;
    }

    // MAPS-LINK PIN — the last rung of the location ladder.
    //
    // The AI web parser harvests the ll= coordinate a ticketing page publishes
    // in its "Open in maps" link and stashes it on _mapsLinkCoordinate, but
    // ONLY after its identity guard confirms the name the link leads with IS
    // the event's venue (placeholders like "Venue TBA" never get stashed).
    // This method is where that candidate meets the pipeline's own answers,
    // and the precedence is:
    //
    //   1. curated coordinates from data/bars — BarDataNormalizer fills them
    //      earlier in this same pipeline, so they are already on the event
    //      when we get here, and they are never touched;
    //   2. a STREET-GRADE forward geocode — the ladder above runs
    //      "<venue>, <address>" then the address-only variants, so its result
    //      is already on the event;
    //   3. THIS pin — written when 1 and 2 left location blank, and preferred
    //      over a geocoded pin whose QUERY carried no street line (see below).
    //
    // Why a geocoded pin can lose to this one: the ladder's last rungs query
    // "<venue>, <city>" with no street line at all, and Nominatim answers those
    // confidently and wrongly. Measured: with the address missing, "Horizon,
    // brighton" resolved to a house called Horizon on Ainsworth Avenue — 5069 m
    // from the venue — and came back EXACT grade with a POI name matching the
    // bar, so no response-side signal caught it. The signal that does catch it
    // is the query itself: no street line means the geocoder was guessing from
    // a name, and an identity-guarded maps-link pin (the venue's own ticketing
    // page, name-matched to the event's bar) is the better evidence. A query
    // that DID carry a street line still wins — that is the case the
    // name-led rung exists to make accurate.
    //
    // Returns true when it wrote a location (so the caller refreshes notes).
    applyMapsLinkCoordinateFallback(event) {
        const candidate = event && typeof event === 'object' ? event._mapsLinkCoordinate : null;
        if (!candidate || typeof candidate !== 'object') return false;
        const candidateLocation = typeof candidate.location === 'string' ? candidate.location.trim() : '';
        const claimed = this.parseCoordinatePairString(candidateLocation);
        // Fails closed on its own input rather than trusting the stash: shape,
        // range, and Null Island (the shape a failed geocode takes) are
        // re-checked here even though the parser already refused them.
        if (!claimed || (claimed.lat === 0 && claimed.lon === 0)) return false;

        const title = event.title || 'unknown';
        const venueName = typeof candidate.venueName === 'string' && candidate.venueName.trim()
            ? candidate.venueName.trim()
            : (typeof event.bar === 'string' ? event.bar.trim() : 'unknown venue');
        const existingLocation = typeof event.location === 'string' ? event.location.trim() : '';

        if (existingLocation) {
            // A better-sourced pin already won. Report the disagreement anyway:
            // this is the line that surfaces the next Westminster Pier, where a
            // ticketing platform's own map points at a different place than the
            // venue's address does.
            const accepted = this.parseCoordinatePairString(existingLocation);
            if (!accepted) return false;
            const distanceMeters = Math.round(this.haversineDistanceKm(
                accepted.lat, accepted.lon, claimed.lat, claimed.lon) * 1000);
            if (distanceMeters < MAPS_LINK_CONFLICT_METERS) return false;
            const acceptedSource = typeof event.pinSource === 'string' && event.pinSource.trim()
                ? event.pinSource.trim()
                : 'unknown source';
            if (this.isNameOnlyGeocodedPin(event)) {
                console.warn(`🗺️ MAPS LINK CONFLICT: "${title}" geocoded pin ${existingLocation} came from the name-only query "${event._geocodeQuery || 'unknown'}" (no address in it) and is ${distanceMeters} m from the page's maps link ${candidateLocation} for "${venueName}" — using the maps link`);
                event.location = candidateLocation;
                event.pinSource = 'maps-link';
                // An address adopted from that same map hit is now evidence
                // from a source this rung just declined to pin with. It is
                // FLAGGED, not deleted: the two observed cases point opposite
                // ways (the Horizon hit's "56 Ainsworth Avenue" is wrong; the
                // Westminster Pier hit's "Victoria Embankment" is right), so
                // dropping it would be a guess of its own.
                if (event.addressSource === 'geo-poi' && event.address) {
                    console.warn(`🗺️ MAPS LINK CONFLICT: "${title}" kept address "${event.address}" — it was adopted from that same declined map hit; verify it`);
                }
                return true;
            }
            console.warn(`🗺️ MAPS LINK CONFLICT: "${title}" accepted pin ${existingLocation} (${acceptedSource}) is ${distanceMeters} m from the page's maps link ${candidateLocation} for "${venueName}" — accepted pin kept; verify which is the real venue`);
            return false;
        }

        event.location = candidateLocation;
        event.pinSource = 'maps-link';
        console.log(`🗺️ OpenStreetMapNormalizer: No curated or geocoded pin for "${title}" — using the page's maps link for "${venueName}" -> ${candidateLocation}`);
        return true;
    }

    // Is the event's accepted pin a GEOCODED pin that came from a NAME-ONLY
    // query — "<venue>, <city>" with no address text in it at all?
    //
    // The rule is deliberately query-side, not response-side. Nominatim's
    // response grade is the precision signal this file trusts everywhere else,
    // and it does not work here: the 5069 m "Horizon, brighton" hit came back
    // EXACT grade, with a POI name that matched the bar. Nothing in the
    // response said "this is a guess". The query did.
    //
    // "Name-only" is the narrowest possible reading — the query carried no
    // address, i.e. it was the venue+city rescue rung or the no-address venue
    // lookup. A query built from the event's address stays street-grade for
    // this purpose even when the street line has no house number or
    // street-type word ("Victoria Embankment, London, UK"); those pins keep
    // winning, which is exactly the case the name-led rung exists to make
    // accurate.
    //
    // Conservative on every axis:
    //   - only geocoded pins qualify (curated and page pins are never second-
    //     guessed here, and a maps-link pin cannot re-judge itself);
    //   - the flag must be explicitly false — a pin carrying no flag at all
    //     (an older record, another writer) keeps its pin (fail closed).
    isNameOnlyGeocodedPin(event) {
        const pinSource = typeof event.pinSource === 'string' ? event.pinSource.trim() : '';
        if (!pinSource.startsWith('geocoded-')) return false;
        return event._geocodeQueryHadAddress === false;
    }

    // "lat, lon" text → { lat, lon } numbers, or null. Local to the
    // normalizers (this file stays platform-pure and dependency-free);
    // isCoordinatePairString above already vets the shape.
    parseCoordinatePairString(value) {
        if (!this.isCoordinatePairString(value)) return null;
        const parts = String(value).split(',');
        const lat = Number(parts[0].trim());
        const lon = Number(parts[1].trim());
        return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    }
}

// ----------------------------------------------------------------------------
// DESCRIPTION FORMATTING SANITIZER (pure, standalone)
// ----------------------------------------------------------------------------
// Event descriptions arrive carrying raw formatting from the source platform
// (run 20260729-125201: dice.fm shipped markdown "**BEEFMINCE | The UK's
// Tastiest Bear Club** **\*Now on Saturdays\***"; a Wix site shipped raw HTML
// with a LITERAL backslash-n "<p>Dress the part ... </p>\n"). This strips
// HTML tags (block-level boundaries become newlines), decodes common HTML
// entities, converts literal two-character "\n" sequences into real newlines,
// removes markdown emphasis runs (** / *** / __), heading markers, link
// syntax, and backslash-escaped punctuation, then collapses whitespace.
// Single "*" characters are deliberately left alone — they appear
// legitimately in event text as bullets/emphasis of unknown intent.
//
// Runs to a fixed point (bounded), so the function is idempotent:
// sanitizeDescriptionFormatting(sanitizeDescriptionFormatting(x)) ===
// sanitizeDescriptionFormatting(x). Plain text passes through byte-identical.

// Block-level tags whose boundaries read as line breaks in plain text.
const SANITIZE_BLOCK_TAG_PATTERN = /<\/?(?:p|div|li|ul|ol|br|hr|h[1-6]|tr|table|thead|tbody|section|article|header|footer|blockquote|pre)\b[^<>]*\/?>/gi;
// Known inline/void HTML tags (stripped to nothing). A KNOWN-NAME whitelist,
// not "anything tag-shaped": legitimate text like "<3", "a < b", or an
// entity-decoded "<here>" must survive — critically, that also keeps the
// sanitizer idempotent (a decoded "&lt;here&gt;" is never re-eaten as a tag
// on the next pass).
const SANITIZE_INLINE_TAG_PATTERN = /<\/?(?:a|abbr|b|bdi|bdo|big|button|center|cite|code|data|dfn|em|figcaption|figure|font|form|i|iframe|img|input|ins|del|kbd|label|main|mark|nav|aside|option|picture|q|rb|rp|rt|ruby|s|samp|select|small|source|span|strike|strong|style|sub|sup|textarea|time|u|var|video|audio|wbr|script|noscript|svg|path|html|head|body|meta|link|title)\b[^<>]*\/?>/gi;
// Placeholders (private-use codepoints) protecting backslash-escaped emphasis
// characters while emphasis RUNS are deleted, so "\*\*TBC\*\**" never has its
// escaped asterisks miscounted as markdown runs.
const SANITIZE_ESCAPED_ASTERISK_PLACEHOLDER = '\uE000';
const SANITIZE_ESCAPED_UNDERSCORE_PLACEHOLDER = '\uE001';

function sanitizeDescriptionFormattingOnce(text) {
    let result = text;

    // Literal escaped line breaks — the two characters backslash+n (run
    // evidence: a Wix description ended in a literal "\n"), not real
    // newlines. Runs before markdown unescaping so "\n" is never mistaken
    // for an escape of "n".
    result = result
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '');

    // HTML: comments vanish, block-tag boundaries become newlines, remaining
    // inline tags vanish.
    result = result.replace(/<!--[\s\S]*?-->/g, '');
    result = result.replace(SANITIZE_BLOCK_TAG_PATTERN, '\n');
    result = result.replace(SANITIZE_INLINE_TAG_PATTERN, '');

    // Common HTML entities. &amp; decodes FIRST so double-encoded entities
    // ("&amp;lt;") resolve within the fixed-point loop instead of leaking.
    result = result
        .replace(/&amp;/gi, '&')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&(?:#39|#039|apos);/gi, "'")
        .replace(/&#(\d+);/g, (match, code) => {
            const codePoint = parseInt(code, 10);
            return codePoint > 0 && codePoint < 0x110000 ? String.fromCodePoint(codePoint) : match;
        })
        .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
            const codePoint = parseInt(code, 16);
            return codePoint > 0 && codePoint < 0x110000 ? String.fromCodePoint(codePoint) : match;
        });

    // Markdown links: [text](url) → text.
    result = result.replace(/\[([^\[\]\n]*)\]\([^()\n]*\)/g, '$1');

    // Markdown heading markers at line start ("# Heading"). The
    // required trailing whitespace keeps hashtags ("#bear") intact.
    result = result.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');

    // Markdown emphasis runs: protect backslash-escaped characters, delete
    // runs of ** / *** / __ entirely, restore escapes as the bare character
    // (which unescapes \* and \_ in the same motion). Single unescaped "*"
    // characters are never touched.
    result = result
        .split('\\*').join(SANITIZE_ESCAPED_ASTERISK_PLACEHOLDER)
        .split('\\_').join(SANITIZE_ESCAPED_UNDERSCORE_PLACEHOLDER)
        .replace(/\*{2,}/g, '')
        .replace(/_{2,}/g, '')
        .split(SANITIZE_ESCAPED_ASTERISK_PLACEHOLDER).join('*')
        .split(SANITIZE_ESCAPED_UNDERSCORE_PLACEHOLDER).join('_');

    // Remaining backslash escapes of markdown punctuation → bare character.
    result = result.replace(/\\([#\[\].])/g, '$1');

    // Whitespace: real carriage returns normalize away, spaces collapse,
    // line-edge spaces trim, 3+ newlines collapse to a paragraph break.
    result = result
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return result;
}

function sanitizeDescriptionFormatting(text) {
    if (typeof text !== 'string' || text === '') return text;
    let current = text;
    for (let pass = 0; pass < 5; pass++) {
        const next = sanitizeDescriptionFormattingOnce(current);
        if (next === current) break;
        current = next;
    }
    return current;
}

// Instance-reachable delegate: shared-core holds only the injected pipeline
// instance (never this module), so the final analyzed-event build calls the
// sanitizer through it.
NormalizerPipeline.prototype.sanitizeDescriptionFormatting = function (text) {
    return sanitizeDescriptionFormatting(text);
};

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NormalizerPipeline, BasicDataNormalizer, LocationNormalizer, BarDataNormalizer, OpenStreetMapNormalizer, sanitizeDescriptionFormatting };
} else if (typeof window !== 'undefined') {
    window.NormalizerPipeline = NormalizerPipeline;
    window.BasicDataNormalizer = BasicDataNormalizer;
    window.LocationNormalizer = LocationNormalizer;
    window.BarDataNormalizer = BarDataNormalizer;
    window.OpenStreetMapNormalizer = OpenStreetMapNormalizer;
    window.sanitizeDescriptionFormatting = sanitizeDescriptionFormatting;
} else {
    // Scriptable environment
    this.NormalizerPipeline = NormalizerPipeline;
    this.BasicDataNormalizer = BasicDataNormalizer;
    this.LocationNormalizer = LocationNormalizer;
    this.BarDataNormalizer = BarDataNormalizer;
    this.OpenStreetMapNormalizer = OpenStreetMapNormalizer;
    this.sanitizeDescriptionFormatting = sanitizeDescriptionFormatting;
}

// Scriptable gives every imported module its own console binding, so the
// adapter's console capture (run-log file) can't see this module's output.
// The orchestrator wires the adapter's file logger in here at startup.
// Returns a restore function; no-ops (returns null) if tee is not a function.
// log/warn/error keep echoing to the visible console; debug becomes file-only
// (full AI payload dumps belong in the run log, not on screen). Idempotent per
// console object: re-wiring returns the existing restore instead of stacking.
function __wireConsoleTee(tee) {
    if (typeof tee !== 'function' || typeof console === 'undefined' || !console) {
        return null;
    }
    if (typeof console.__consoleTeeRestore === 'function') {
        return console.__consoleTeeRestore;
    }
    const original = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug
    };
    const wrap = (level, method, echo) => function (...args) {
        try {
            tee(level, args);
        } catch (teeError) {
            // Log capture must never break the caller.
        }
        if (echo && typeof method === 'function') {
            method.apply(console, args);
        }
    };
    console.log = wrap('info', original.log, true);
    console.warn = wrap('warn', original.warn, true);
    console.error = wrap('error', original.error, true);
    console.debug = wrap('debug', original.debug, false);
    const restore = function () {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
        console.debug = original.debug;
        delete console.__consoleTeeRestore;
    };
    console.__consoleTeeRestore = restore;
    return restore;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports.__wireConsoleTee = __wireConsoleTee;
}

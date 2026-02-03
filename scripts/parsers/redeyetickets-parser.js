// ============================================================================
// REDEYETICKETS PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (JSON processing)
// ✅ Venue-specific extraction logic for redeyetickets.com
// ✅ Date/time parsing and formatting
// ✅ Event object creation and validation
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Environment detection (typeof importModule, typeof window, typeof DOMParser)
// ❌ HTTP requests (receive HTML data, don't fetch it)
// ❌ Calendar operations (return event objects, don't save them)
// ❌ Scriptable APIs (Request, Calendar, FileManager, Alert)
// ❌ DOM APIs that don't work in all environments
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class RedEyeTicketsParser {
    constructor(config = {}) {
        this.config = {
            source: 'redeyetickets',
            maxAdditionalUrls: 20,
            ...config
        };
    }

    // Main parsing method - receives response data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const rawText = htmlData.html;
            
            if (!rawText) {
                console.warn('🎫 RedEyeTickets: No response content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            const jsonParseResult = this.parseJsonPayload(rawText, htmlData.url, parserConfig, cityConfig);
            if (!jsonParseResult) {
                console.error('🎫 RedEyeTickets: Expected JSON response, skipping HTML parsing');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            const jsonEvents = jsonParseResult.events || [];
            const additionalLinks = parserConfig.urlDiscoveryDepth > 0 ? (jsonParseResult.additionalLinks || []) : [];
            console.log(`🎫 RedEyeTickets: Parsed API payload -> ${jsonEvents.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events: jsonEvents,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🎫 RedEyeTickets: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Parse JSON responses from the Red Eye Tickets API
    parseJsonPayload(rawText, sourceUrl, parserConfig = {}, cityConfig = null) {
        const trimmed = rawText.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return null;
        }
        
        let payload;
        try {
            payload = JSON.parse(trimmed);
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Failed to parse JSON payload: ${error}`);
            return null;
        }
        
        const data = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'data')
            ? payload.data
            : payload;
        
        if (Array.isArray(data)) {
            const additionalLinks = this.extractApiEventLinks(data, sourceUrl, parserConfig);
            return { events: [], additionalLinks: additionalLinks };
        }
        
        if (data && typeof data === 'object') {
            const events = this.parseApiEventData(data, sourceUrl, parserConfig, cityConfig);
            return { events: events, additionalLinks: [] };
        }
        
        console.warn('🎫 RedEyeTickets: Unrecognized JSON payload structure');
        return { events: [], additionalLinks: [] };
    }

    parseApiEventData(eventData, sourceUrl, parserConfig = {}, cityConfig = null) {
        const performances = Array.isArray(eventData.performances) ? eventData.performances : [];
        if (performances.length === 0) {
            console.warn('🎫 RedEyeTickets: No performances found in API event data');
            return [];
        }
        
        const title = this.normalizeText(eventData.name || eventData.headline || '');
        if (!title) {
            console.warn('🎫 RedEyeTickets: API event missing title');
            return [];
        }
        
        const description = this.extractApiDescription(eventData.description || '');
        const venue = this.normalizeText(eventData.venue || eventData.venue_name || eventData.venueName || '');
        const address = this.buildAddressFromApi(eventData);
        const coordinates = this.extractApiCoordinates(eventData);
        const city = this.extractCityFromVenue({ venue, address }, cityConfig);
        const image = this.extractApiImage(eventData);
        const publicUrl = this.buildPublicEventUrl(eventData.slug, sourceUrl);
        
        const baseEvent = {
            title: title,
            description: description,
            bar: venue || null,
            address: address,
            location: coordinates ? `${coordinates.lat}, ${coordinates.lng}` : null,
            city: city,
            timezone: null, // Let SharedCore assign timezone based on city
            image: image,
            ticketUrl: publicUrl,
            url: publicUrl,
            source: this.config.source,
            isBearEvent: parserConfig.alwaysBear || false
        };
        
        const events = [];
        performances.forEach((performance, index) => {
            const timeZone = performance.time_zone || eventData.venue_time_zone || null;
            const resolvedTimeZone = this.resolveTimeZone(timeZone, city, cityConfig);
            const startDate = this.parseApiDate(performance.start_at, resolvedTimeZone);
            if (!startDate) {
                console.warn(`🎫 RedEyeTickets: Performance ${index + 1} missing start time`);
                return;
            }
            
            const endDate = this.parseApiDate(performance.end_at, resolvedTimeZone);
            const resolvedEndDate = this.resolvePerformanceEndDate(startDate, endDate, resolvedTimeZone, venue);
            const cover = this.extractApiPricing(performance);
            
            const event = {
                ...baseEvent,
                startDate: startDate,
                endDate: resolvedEndDate,
                cover: cover
            };
            
            this.applyMetadata(event, parserConfig);
            events.push(event);
        });
        
        return events;
    }

    extractApiEventLinks(items, sourceUrl, parserConfig = {}) {
        const urls = new Set();
        const apiBaseUrl = this.getApiBaseUrl(sourceUrl);
        const maxUrls = typeof parserConfig.maxAdditionalUrls === 'number'
            ? parserConfig.maxAdditionalUrls
            : this.config.maxAdditionalUrls;
        
        items.forEach(item => {
            const slug = this.normalizeText(item.slug || item.event_slug || item.eventSlug || '');
            if (!slug) {
                return;
            }
            urls.add(`${apiBaseUrl}/events/${slug}`);
        });
        
        return Array.from(urls).slice(0, maxUrls || this.config.maxAdditionalUrls);
    }

    buildPublicEventUrl(slug, sourceUrl) {
        if (!slug) {
            return sourceUrl || '';
        }
        const publicBase = this.config.publicBaseUrl || 'https://redeyetickets.com';
        return `${publicBase.replace(/\/+$/, '')}/events/${slug}`;
    }

    getApiBaseUrl(sourceUrl) {
        const urlPattern = /^(https?:)\/\/([^\/]+)/;
        const match = sourceUrl ? sourceUrl.match(urlPattern) : null;
        const origin = match ? `${match[1]}//${match[2]}` : 'https://api.redeyetickets.com';
        return `${origin.replace(/\/+$/, '')}/api/v1`;
    }

    parseApiDate(value, timeZone = null) {
        if (!value || typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        const hasTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(trimmed);
        
        if (hasTimezone) {
            const date = new Date(trimmed);
            if (isNaN(date.getTime())) {
                console.warn(`🎫 RedEyeTickets: Invalid API date: ${value}`);
                return null;
            }
            return date;
        }
        
        const localParts = this.parseLocalDateTime(trimmed);
        if (localParts) {
            const resolvedTimeZone = this.normalizeTimeZone(timeZone);
            
            if (resolvedTimeZone === 'UTC') {
                const utcDate = new Date(Date.UTC(
                    localParts.year,
                    localParts.month,
                    localParts.day,
                    localParts.hour,
                    localParts.minute,
                    localParts.second,
                    0
                ));
                if (isNaN(utcDate.getTime())) {
                    console.warn(`🎫 RedEyeTickets: Invalid API date: ${value}`);
                    return null;
                }
                return utcDate;
            }
            
            if (resolvedTimeZone) {
                return this.convertLocalTimeToUTC(
                    localParts.year,
                    localParts.month,
                    localParts.day,
                    localParts.hour,
                    localParts.minute,
                    localParts.second,
                    resolvedTimeZone
                );
            }
        }
        
        const date = new Date(trimmed);
        if (isNaN(date.getTime())) {
            console.warn(`🎫 RedEyeTickets: Invalid API date: ${value}`);
            return null;
        }
        return date;
    }
    
    parseLocalDateTime(value) {
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!match) {
            return null;
        }
        return {
            year: Number(match[1]),
            month: Number(match[2]) - 1,
            day: Number(match[3]),
            hour: match[4] ? Number(match[4]) : 0,
            minute: match[5] ? Number(match[5]) : 0,
            second: match[6] ? Number(match[6]) : 0
        };
    }
    
    resolveTimeZone(timeZone, city, cityConfig) {
        const normalized = this.normalizeTimeZone(timeZone);
        if (normalized && normalized !== 'UTC') {
            return normalized;
        }
        const cityTimeZone = city && cityConfig && cityConfig[city] && cityConfig[city].timezone
            ? cityConfig[city].timezone
            : null;
        return cityTimeZone || normalized || null;
    }
    
    normalizeTimeZone(timeZone) {
        if (!timeZone || typeof timeZone !== 'string') {
            return null;
        }
        const normalized = timeZone.trim();
        return normalized.length > 0 ? normalized : null;
    }

    resolvePerformanceEndDate(startDate, endDate, timeZone, venueName) {
        let resolvedEndDate = endDate;
        
        if (resolvedEndDate && startDate && resolvedEndDate <= startDate) {
            resolvedEndDate = null;
        }
        
        if (!resolvedEndDate && startDate && venueName && venueName.toLowerCase().includes('red eye')) {
            const timezone = timeZone || 'America/New_York';
            const nextDay = new Date(startDate);
            nextDay.setDate(nextDay.getDate() + 1);
            const year = nextDay.getFullYear();
            const month = nextDay.getMonth();
            const day = nextDay.getDate();
            resolvedEndDate = this.convertLocalTimeToUTC(year, month, day, 4, 0, 0, timezone);
        }
        
        return resolvedEndDate;
    }

    extractApiCoordinates(eventData) {
        const lat = parseFloat(eventData.venue_latitude);
        const lng = parseFloat(eventData.venue_longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { lat, lng };
        }
        return null;
    }

    buildAddressFromApi(eventData) {
        const line1 = this.normalizeText(eventData.venue_address_line_1 || '');
        const line2 = this.normalizeText(eventData.venue_address_line_2 || '');
        const city = this.normalizeText(eventData.venue_locality || eventData.venue_city || '');
        const state = this.normalizeText(eventData.venue_admin_area || eventData.venue_state || '');
        const postal = this.normalizeText(eventData.venue_postal_code || eventData.venue_zip || '');
        
        const street = [line1, line2].filter(Boolean).join(' ');
        const cityStateZip = [city, state, postal].filter(Boolean).join(' ').trim();
        
        const parts = [street, cityStateZip].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : null;
    }

    extractApiDescription(descriptionHtml) {
        if (!descriptionHtml || typeof descriptionHtml !== 'string') {
            return '';
        }
        
        return descriptionHtml
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/p>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    extractApiImage(eventData) {
        const imageCandidates = [
            eventData.flyer_url,
            eventData.portrait_cover_url,
            eventData.landscape_cover_url,
            eventData.social_image_url,
            eventData.alt_image_url
        ];
        
        const image = imageCandidates.find(candidate => candidate && typeof candidate === 'string');
        return image ? image.trim() : '';
    }

    extractApiPricing(performance) {
        const ticketOptions = Array.isArray(performance.ticket_options) ? performance.ticket_options : [];
        const prices = ticketOptions
            .map(option => option.price_cents)
            .filter(value => typeof value === 'number' && !isNaN(value));
        
        if (prices.length === 0) {
            return '';
        }
        
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const minFormatted = this.formatPriceCents(min);
        const maxFormatted = this.formatPriceCents(max);
        
        let priceString = min === max ? `$${minFormatted}` : `$${minFormatted} - $${maxFormatted}`;
        
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        priceString += ` (as of ${month}/${day})`;
        
        return priceString;
    }

    formatPriceCents(priceCents) {
        const dollars = (priceCents / 100).toFixed(2);
        return dollars.endsWith('.00') ? dollars.slice(0, -3) : dollars;
    }

    normalizeText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        return text.replace(/\s+/g, ' ').trim();
    }

    applyMetadata(event, parserConfig) {
        if (!parserConfig || !parserConfig.metadata) {
            return;
        }
        
        Object.keys(parserConfig.metadata).forEach(key => {
            const metaValue = parserConfig.metadata[key];
            
            // Apply value if it exists (source-specific overrides)
            if (typeof metaValue === 'object' && metaValue !== null && 'value' in metaValue) {
                event[key] = metaValue.value;
            }
        });
    }

    // Extract city from venue information
    extractCityFromVenue(venueInfo, cityConfig) {
        if (!venueInfo || !cityConfig) return null;
        
        const searchText = `${venueInfo.venue || ''} ${venueInfo.address || ''}`.toLowerCase();
        
        // Check each city's patterns
        for (const [cityKey, cityData] of Object.entries(cityConfig)) {
            if (cityData.patterns && Array.isArray(cityData.patterns)) {
                for (const pattern of cityData.patterns) {
                    if (searchText.includes(pattern.toLowerCase())) {
                        return cityKey;
                    }
                }
            }
        }
        return null;
    }

    // Helper method to get timezone offset in minutes using Intl.DateTimeFormat
    getTimezoneOffset(timezone, date = new Date()) {
        try {
            // Use Intl.DateTimeFormat to get the correct offset for this timezone at this date
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: timezone,
                timeZoneName: 'longOffset'
            });
            
            const parts = formatter.formatToParts(date);
            const offsetPart = parts.find(part => part.type === 'timeZoneName');
            
            if (offsetPart && offsetPart.value) {
                // Parse offset like "GMT-04:00" or "GMT+09:00"
                const offsetMatch = offsetPart.value.match(/GMT([+-])(\d{2}):(\d{2})/);
                if (offsetMatch) {
                    const sign = offsetMatch[1] === '+' ? 1 : -1;
                    const offsetHours = parseInt(offsetMatch[2]);
                    const offsetMinutes = parseInt(offsetMatch[3]);
                    const totalOffsetMinutes = sign * (offsetHours * 60 + offsetMinutes);
                    return totalOffsetMinutes;
                }
            }
            
            console.warn(`🎫 RedEyeTickets: Could not parse timezone offset for ${timezone}, using default`);
            return -300; // Default to EST (UTC-5)
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Error getting timezone offset for ${timezone}: ${error.message}`);
            return -300; // Default to EST (UTC-5)
        }
    }

    // Helper method to convert a local time to UTC using proper timezone handling
    convertLocalTimeToUTC(year, month, day, hour, minute, second, timezone) {
        try {
            // Create a date string in ISO format
            const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
            
            // Create a date object representing the local time in the target timezone
            const localDate = new Date(dateString + 'Z'); // Start with UTC
            
            // Get the timezone offset for this specific date
            const offsetMinutes = this.getTimezoneOffset(timezone, localDate);
            
            // Convert from local time to UTC
            // The offset represents how many minutes the timezone is behind UTC
            // So to convert local time to UTC, we SUBTRACT the offset (since local time is behind UTC)
            const utcDate = new Date(localDate.getTime() - (offsetMinutes * 60 * 1000));
            return utcDate;
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Error converting local time to UTC: ${error.message}`);
            // Fallback to simple UTC conversion
            return new Date(Date.UTC(year, month, day, hour, minute, second, 0));
        }
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RedEyeTicketsParser };
} else if (typeof window !== 'undefined') {
    window.RedEyeTicketsParser = RedEyeTicketsParser;
} else {
    // Scriptable environment
    this.RedEyeTicketsParser = RedEyeTicketsParser;
}
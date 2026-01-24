// ============================================================================
// REDEYETICKETS PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
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

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🎫 RedEyeTickets: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            const jsonParseResult = this.parseJsonPayload(html, htmlData.url, parserConfig, cityConfig);
            if (jsonParseResult) {
                const jsonEvents = jsonParseResult.events || [];
                const additionalLinks = parserConfig.urlDiscoveryDepth > 0 ? (jsonParseResult.additionalLinks || []) : [];
                console.log(`🎫 RedEyeTickets: Parsed API payload -> ${jsonEvents.length} events, ${additionalLinks.length} additional links`);
                
                return {
                    events: jsonEvents,
                    additionalLinks: additionalLinks,
                    source: this.config.source,
                    url: htmlData.url
                };
            }
            
            // Parse HTML using regex (works in all environments)
            const htmlEvents = this.parseHTMLEvents(html, htmlData.url, parserConfig, cityConfig);
            events.push(...htmlEvents);
            
            // Extract additional URLs if urlDiscoveryDepth > 0 (depth checking is handled by shared-core)
            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            }
            
            console.log(`🎫 RedEyeTickets: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🎫 RedEyeTickets: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Parse HTML events using regex (environment-agnostic)
    parseHTMLEvents(html, sourceUrl, parserConfig = {}, cityConfig = null) {
        const events = [];
        
        try {
            // Extract event details from the page structure
            const event = this.parseEventFromPage(html, sourceUrl, parserConfig, cityConfig);
            if (event) {
                events.push(event);
                console.log(`🎫 RedEyeTickets: Parsed event: ${event.title}`);
            }
            
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Error parsing HTML events: ${error}`);
        }
        
        return events;
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
            const startDate = this.parseApiDate(performance.start_at);
            if (!startDate) {
                console.warn(`🎫 RedEyeTickets: Performance ${index + 1} missing start time`);
                return;
            }
            
            const endDate = this.parseApiDate(performance.end_at);
            const timeZone = performance.time_zone || eventData.venue_time_zone || null;
            const resolvedEndDate = this.resolvePerformanceEndDate(startDate, endDate, timeZone, venue);
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

    parseApiDate(value) {
        if (!value || typeof value !== 'string') {
            return null;
        }
        const date = new Date(value);
        if (isNaN(date.getTime())) {
            console.warn(`🎫 RedEyeTickets: Invalid API date: ${value}`);
            return null;
        }
        return date;
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
            console.log(`🎫 RedEyeTickets: Set default end date for Red Eye event: ${resolvedEndDate.toISOString()} (4am ${timezone})`);
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

    // Parse individual event from the page
    parseEventFromPage(html, sourceUrl, parserConfig = {}, cityConfig = null) {
        try {
            // Extract title from meta tags or page content
            let title = this.extractTitle(html);
            if (!title) {
                console.warn('🎫 RedEyeTickets: No title found');
                return null;
            }
            
            // Extract venue and address FIRST so we can get city for date parsing
            const venueInfo = this.extractVenueInfo(html);
            
            // Extract city from address or venue info
            const city = this.extractCityFromVenue(venueInfo, cityConfig);
            
            // Extract date and time (now we can pass city info)
            const dateTime = this.extractDateTime(html, cityConfig, city);
            if (!dateTime.startDate) {
                console.warn('🎫 RedEyeTickets: No valid date found');
                return null;
            }
            
            // Extract description
            const description = this.extractDescription(html);
            
            // Extract pricing information
            const pricing = this.extractPricing(html);
            
            // Extract image
            const image = this.extractImage(html);
            
            // Let SharedCore handle timezone assignment based on detected city
            
            // Extract coordinates from venue info
            const coordinates = this.extractCoordinates(venueInfo);
            
            // Set default end date for Red Eye bar events (4am next day)
            let endDate = dateTime.endDate;
            if (!endDate && dateTime.startDate && venueInfo.venue && venueInfo.venue.toLowerCase().includes('red eye')) {
                // Get the timezone for the detected city, default to Eastern Time
                const cityTimezone = city && cityConfig && cityConfig[city] ? cityConfig[city].timezone : 'America/New_York';
                
                // Create end date by adding 1 day and setting to 4am
                const startDate = new Date(dateTime.startDate);
                const nextDay = new Date(startDate);
                nextDay.setDate(nextDay.getDate() + 1);
                
                // Extract date components for the next day
                const year = nextDay.getFullYear();
                const month = nextDay.getMonth();
                const day = nextDay.getDate();
                
                // Use proper timezone conversion for 4am in the event's timezone
                endDate = this.convertLocalTimeToUTC(year, month, day, 4, 0, 0, cityTimezone);
                
                console.log(`🎫 RedEyeTickets: Set default end date for Red Eye bar event: ${endDate.toISOString()} (4am ${cityTimezone})`);
            }

            const event = {
                title: title,
                description: description,
                startDate: dateTime.startDate,
                endDate: endDate,
                bar: venueInfo.venue,
                location: coordinates ? `${coordinates.lat}, ${coordinates.lng}` : null,
                address: venueInfo.address,
                city: city,
                timezone: null, // Let SharedCore assign timezone based on city
                cover: pricing,
                image: image,
                ticketUrl: sourceUrl, // Use the source URL as the ticket URL
                url: sourceUrl,
                source: this.config.source,
                isBearEvent: parserConfig.alwaysBear || false
            };
            
            this.applyMetadata(event, parserConfig);
            
            return event;
            
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Failed to parse event from page: ${error}`);
            return null;
        }
    }

    // Extract title from meta tags or page content
    extractTitle(html) {
        // Try meta title first
        const metaTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (metaTitleMatch) {
            let title = metaTitleMatch[1].trim();
            // Remove " - Red Eye Tickets" suffix
            title = title.replace(/\s*-\s*Red Eye Tickets\s*$/i, '');
            if (title) {
                return title;
            }
        }
        
        // Try og:title
        const ogTitleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
        if (ogTitleMatch) {
            return ogTitleMatch[1].trim();
        }
        
        // Try h1 tag
        const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (h1Match) {
            return h1Match[1].trim();
        }
        
        return null;
    }

    // Extract date and time information
    extractDateTime(html, cityConfig = null, city = null) {
        // Look for date pattern: "Saturday, October 25, 2025 at 9pm"
        const dateTimeMatch = html.match(/<p[^>]*><strong>([^<]+)<\/strong>/i);
        if (dateTimeMatch) {
            const dateTimeString = dateTimeMatch[1].trim();
            console.log(`🎫 RedEyeTickets: Found date/time string: "${dateTimeString}"`);
            
            // Parse the date string
            const parsedDate = this.parseRedEyeDateString(dateTimeString, cityConfig, city);
            if (parsedDate) {
                return parsedDate;
            }
        }
        
        // No fallback for time - only parse if time is explicitly found
        
        return { startDate: null, endDate: null };
    }

    // Parse RedEyeTickets specific date format
    parseRedEyeDateString(dateString, cityConfig = null, city = null) {
        try {
            // Convert RedEyeTickets format to something Date constructor can handle
            // Input: "Saturday, October 25, 2025 at 9pm" or "Saturday, November 22, 2025 at 8:30pm"
            // Output: "October 25, 2025 9:00 PM" or "November 22, 2025 8:30 PM"
            
            const fullMatch = dateString.match(/(\w+),\s+(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+at\s+(\d{1,2})(?::(\d{2}))?(\w+)/i);
            if (fullMatch) {
                const [, dayOfWeek, month, day, year, hour, minutes, ampm] = fullMatch;
                
                // Normalize the format for Date constructor
                const normalizedTime = minutes ? `${hour}:${minutes}` : `${hour}:00`;
                const normalizedAmPm = ampm.toUpperCase();
                const dateStringForConstructor = `${month} ${day}, ${year} ${normalizedTime} ${normalizedAmPm}`;
                
                // Let new Date() handle the complex parsing, then extract components
                const parsedDate = new Date(dateStringForConstructor);
                
                // Check if date is valid
                if (isNaN(parsedDate.getTime())) {
                    console.warn(`🎫 RedEyeTickets: Invalid date string: "${dateStringForConstructor}"`);
                    return null;
                }
                
                // Extract the parsed components (these are in system timezone)
                const parsedYear = parsedDate.getFullYear();
                const parsedMonth = parsedDate.getMonth();
                const parsedDay = parsedDate.getDate();
                const parsedHour = parsedDate.getHours();
                const parsedMinute = parsedDate.getMinutes();
                const parsedSecond = parsedDate.getSeconds();
                
                // Get the timezone for the detected city, default to Eastern Time
                const cityTimezone = city && cityConfig && cityConfig[city] ? cityConfig[city].timezone : 'America/New_York';
                
                // Use proper timezone conversion instead of hardcoded offsets
                const adjustedDate = this.convertLocalTimeToUTC(
                    parsedYear, parsedMonth, parsedDay, parsedHour, parsedMinute, parsedSecond, cityTimezone
                );
                
                console.log(`🎫 RedEyeTickets: Parsed components: ${parsedYear}-${parsedMonth+1}-${parsedDay} ${parsedHour}:${parsedMinute.toString().padStart(2,'0')}`);
                console.log(`🎫 RedEyeTickets: Converted to UTC using ${cityTimezone}: ${adjustedDate.toISOString()}`);
                return { startDate: adjustedDate, endDate: null };
            }
            
            // Handle format: "Oct. 25, 2025" (from meta description) - NO TIME FALLBACK
            const shortMatch = dateString.match(/(\w+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
            if (shortMatch) {
                console.log(`🎫 RedEyeTickets: Found date without time: "${dateString}" - skipping (no time fallback)`);
                return null;
            }
            
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Error parsing date string "${dateString}": ${error}`);
        }
        
        return null;
    }

    // Extract venue information
    extractVenueInfo(html) {
        // First try to extract venue name from the content area
        const venueMatch = html.match(/<p[^>]*><strong>[^<]+<\/strong><br>([^<]+)<\/p>/i);
        if (venueMatch) {
            const venueText = venueMatch[1].trim();
            console.log(`🎫 RedEyeTickets: Found venue text: "${venueText}"`);
            
            // Split venue name and address - look for the last dash before the address
            const lastDashIndex = venueText.lastIndexOf('-');
            if (lastDashIndex > 0) {
                const venue = venueText.substring(0, lastDashIndex).trim();
                const contentAddress = venueText.substring(lastDashIndex + 1).trim();
                
                // Check if this is a Red Eye Tickets venue (contains "Red Eye" in venue name)
                const isRedEyeVenue = venue.toLowerCase().includes('red eye');
                
                if (isRedEyeVenue) {
                    // For Red Eye venues, use the footer address (contains full city info)
                    const footerMatch = html.match(/<div class="one">[^<]*Red Eye Tickets[^<]*◦\s*([^◦]+)◦\s*([^<]+)</i);
                    if (footerMatch) {
                        const streetAddress = footerMatch[1].trim();
                        const cityStateZip = footerMatch[2].trim();
                        const fullAddress = `${streetAddress}, ${cityStateZip}`;
                        console.log(`🎫 RedEyeTickets: Red Eye venue detected, using full address from footer: "${fullAddress}"`);
                        return { venue, address: fullAddress };
                    }
                } else {
                    // For non-Red Eye venues, use the address from content area
                    console.log(`🎫 RedEyeTickets: Non-Red Eye venue detected, using address from content: "${contentAddress}"`);
                    return { venue, address: contentAddress };
                }
            }
        }
        
        // Fallback: Try to get address from footer (for Red Eye venues without content area venue info)
        const footerMatch = html.match(/<div class="one">[^<]*Red Eye Tickets[^<]*◦\s*([^◦]+)◦\s*([^<]+)</i);
        if (footerMatch) {
            const streetAddress = footerMatch[1].trim();
            const cityStateZip = footerMatch[2].trim();
            const fullAddress = `${streetAddress}, ${cityStateZip}`;
            console.log(`🎫 RedEyeTickets: Found footer address: "${fullAddress}"`);
            
            // Try to extract venue name from page title/meta
            const titleMatch = html.match(/<h1[^>]*>([^<]+)</i) || 
                              html.match(/<title[^>]*>([^<]+)</i) ||
                              html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
            
            if (titleMatch) {
                const venueName = titleMatch[1].trim();
                console.log(`🎫 RedEyeTickets: Using venue from title: "${venueName}", full address from footer: "${fullAddress}"`);
                return { venue: venueName, address: fullAddress };
            }
            
            // If no venue name found, return null venue but full address
            console.log(`🎫 RedEyeTickets: No venue name found, using full address from footer: "${fullAddress}"`);
            return { venue: null, address: fullAddress };
        }
        
        // No fallback - return null if venue info not found
        console.log('🎫 RedEyeTickets: No venue information found in page');
        return { venue: null, address: null };
    }

    // Extract description
    extractDescription(html) {
        // Look for the main description paragraph with event content
        // This extracts the clean description without date/title from the content
        const descMatch = html.match(/<p[^>]*class="has-text-align-center"[^>]*>([^<]+(?:<br[^>]*>[^<]+)*)<\/p>/i);
        if (descMatch) {
            let description = descMatch[1]
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            // Look for descriptions that contain event details (not just titles)
            if (description.length > 50 && !description.match(/^[A-Z\s&]+$/)) {
                // Try to extract the description part after the event title
                // Look for patterns like "EVENT NAME – THEME" followed by description
                const eventDescMatch = description.match(/^[A-Z\s&]+[–-]\s*[A-Z\s&]*[–-]\s*(.+)$/i);
                if (eventDescMatch) {
                    const cleanDesc = eventDescMatch[1].trim();
                    if (cleanDesc && cleanDesc.length > 10) {
                        console.log(`🎫 RedEyeTickets: Found clean description in paragraph: "${cleanDesc}"`);
                        return cleanDesc;
                    }
                }
                
                // If no dash pattern, try to find the description after the first strong text
                const strongMatch = description.match(/<strong>([^<]+)<\/strong>[^<]*[–-]\s*<strong>([^<]+)<\/strong>[^<]*<br[^>]*><br[^>]*>([^<]+)/i);
                if (strongMatch) {
                    const cleanDesc = strongMatch[3]
                        .replace(/&amp;/g, '&')
                        .replace(/&nbsp;/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    if (cleanDesc && cleanDesc.length > 10) {
                        console.log(`🎫 RedEyeTickets: Found description after strong tags: "${cleanDesc}"`);
                        return cleanDesc;
                    }
                }
            }
        }
        
        // Alternative approach: Look for description text after double line breaks
        const doubleBrMatch = html.match(/<p[^>]*class="has-text-align-center"[^>]*>.*?<br[^>]*><br[^>]*>([^<]+)<\/p>/i);
        if (doubleBrMatch) {
            let cleanDesc = doubleBrMatch[1]
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            if (cleanDesc && cleanDesc.length > 20) {
                console.log(`🎫 RedEyeTickets: Found description after double breaks: "${cleanDesc}"`);
                return cleanDesc;
            }
        }
        
        // Try to get the full description from multiple paragraphs
        const fullDescMatch = html.match(/<p[^>]*class="has-text-align-center"[^>]*>([^<]+(?:<br[^>]*>[^<]+)*)<\/p>.*?<p[^>]*class="has-text-align-center"[^>]*>([^<]+(?:<br[^>]*>[^<]+)*)<\/p>/is);
        if (fullDescMatch) {
            let description = (fullDescMatch[1] + ' ' + fullDescMatch[2])
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            if (description && description.length > 20) {
                console.log(`🎫 RedEyeTickets: Found description in multiple paragraphs: "${description}"`);
                return description;
            }
        }
        
        // Fallback: Try to get description from meta tags (but clean it up)
        const metaDescMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
        if (metaDescMatch) {
            const metaDesc = metaDescMatch[1].trim();
            if (metaDesc && metaDesc.length > 20) {
                // Remove date and title from meta description using generic patterns
                let cleanDesc = metaDesc
                    .replace(/^[^–-]*[–-]\s*[A-Z\s&]+[–-]\s*/i, '') // Remove date and title prefix
                    .replace(/^[A-Z\s&]+[–-]\s*/i, '') // Remove just title prefix
                    .trim();
                
                if (cleanDesc && cleanDesc.length > 10) {
                    console.log(`🎫 RedEyeTickets: Found cleaned description in meta tags: "${cleanDesc}"`);
                    return cleanDesc;
                }
            }
        }
        
        // Try to get description from og:description (but clean it up)
        const ogDescMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
        if (ogDescMatch) {
            const ogDesc = ogDescMatch[1].trim();
            if (ogDesc && ogDesc.length > 20) {
                // Remove date and title from og description using generic patterns
                let cleanDesc = ogDesc
                    .replace(/^[^–-]*[–-]\s*[A-Z\s&]+[–-]\s*/i, '') // Remove date and title prefix
                    .replace(/^[A-Z\s&]+[–-]\s*/i, '') // Remove just title prefix
                    .trim();
                
                if (cleanDesc && cleanDesc.length > 10) {
                    console.log(`🎫 RedEyeTickets: Found cleaned description in og:description: "${cleanDesc}"`);
                    return cleanDesc;
                }
            }
        }
        
        // No fallback - return empty string if description not found
        console.log('🎫 RedEyeTickets: No description found in page');
        return '';
    }

    // Extract pricing information
    extractPricing(html) {
        const prices = [];
        
        // Look for price patterns in the ticket table
        const priceMatches = html.matchAll(/<td[^>]*data-column="Price"[^>]*>([^<]+)<\/td>/gi);
        for (const match of priceMatches) {
            const price = match[1].trim();
            if (price && price.startsWith('$')) {
                prices.push(price);
            }
        }
        
        if (prices.length > 0) {
            // Remove duplicates and sort
            const uniquePrices = [...new Set(prices)].sort((a, b) => {
                const aNum = parseFloat(a.replace('$', ''));
                const bNum = parseFloat(b.replace('$', ''));
                return aNum - bNum;
            });
            
            let priceString;
            if (uniquePrices.length === 1) {
                priceString = uniquePrices[0];
            } else {
                priceString = `${uniquePrices[0]} - ${uniquePrices[uniquePrices.length - 1]}`;
            }
            
            // Add availability hint like eventbrite parser
            const now = new Date();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            priceString += ` (as of ${month}/${day})`;
            
            return priceString;
        }
        
        return '';
    }

    // Extract image URL
    extractImage(html) {
        // Look for images in the content area (after the main banner)
        // These are typically event-specific images with larger dimensions
        const contentImgMatches = html.matchAll(/<img[^>]*src="([^"]*\.(?:jpg|jpeg|png|gif))"[^>]*(?:width="\d+"|height="\d+")[^>]*>/gi);
        const contentImages = Array.from(contentImgMatches).map(match => match[1]);
        
        // Filter out banners, logos, and small images
        const eventImages = contentImages.filter(img => 
            !img.toLowerCase().includes('banner') && 
            !img.toLowerCase().includes('wp-post-image') &&
            !img.toLowerCase().includes('attachment-post-thumbnail') &&
            !img.toLowerCase().includes('logo') &&
            !img.toLowerCase().includes('red_eye_03') && // Logo file
            !img.toLowerCase().includes('icon')
        );
        
        if (eventImages.length > 0) {
            // Use the first event-specific image found
            const selectedImage = eventImages[0];
            console.log(`🎫 RedEyeTickets: Using event-specific image: "${selectedImage}"`);
            return selectedImage.trim();
        }
        
        // Fallback: Look for any image in wp-block-image (content images)
        const wpBlockImgMatch = html.match(/<figure[^>]*class="[^"]*wp-block-image[^"]*"[^>]*>.*?<img[^>]*src="([^"]+)"/is);
        if (wpBlockImgMatch) {
            console.log(`🎫 RedEyeTickets: Using wp-block-image: "${wpBlockImgMatch[1]}"`);
            return wpBlockImgMatch[1].trim();
        }
        
        // Log the main banner for reference
        const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
        if (ogImageMatch) {
            console.log(`🎫 RedEyeTickets: Found main banner: "${ogImageMatch[1]}"`);
        }
        
        // Try featured image as final fallback
        const imgMatch = html.match(/<img[^>]*class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]+)"/i);
        if (imgMatch) {
            console.log(`🎫 RedEyeTickets: Using fallback featured image: "${imgMatch[1]}"`);
            return imgMatch[1].trim();
        }
        
        console.log('🎫 RedEyeTickets: No image found');
        return '';
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            console.log(`🎫 RedEyeTickets: Extracting additional event URLs`);
            
            // Look for event links in the page
            const linkMatches = html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/gi);
            for (const match of linkMatches) {
                const url = this.normalizeUrl(match[1], sourceUrl);
                if (this.isValidEventUrl(url, sourceUrl)) {
                    urls.add(url);
                }
            }
            
            console.log(`🎫 RedEyeTickets: Extracted ${urls.size} additional URLs`);
            
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls).slice(0, this.config.maxAdditionalUrls);
    }

    // Validate if URL is a valid event URL
    isValidEventUrl(url, sourceUrl) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            // Use simple URL parsing that works in Scriptable
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            
            const urlMatch = url.match(urlPattern);
            const sourceMatch = sourceUrl.match(urlPattern);
            
            if (!urlMatch || !sourceMatch) return false;
            
            const urlHostname = urlMatch[2].split(':')[0]; // Remove port if present
            const sourceHostname = sourceMatch[2].split(':')[0]; // Remove port if present
            
            // Should be from the same domain
            if (!urlHostname.includes(sourceHostname) && 
                !sourceHostname.includes(urlHostname)) return false;
            
            // Avoid admin, login, or social media links
            const invalidPaths = [
                '/admin', '/login', '/wp-admin', '/wp-login', '/user/', '/profile/',
                '#', 'javascript:', 'mailto:', 'tel:', 'sms:',
                'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com',
                '/terms-conditions/', '/contact/', '/yourevent/'
            ];
            
            if (invalidPaths.some(invalid => url.toLowerCase().includes(invalid))) return false;
            
            // Should look like an event page (not the main page)
            const pathname = urlMatch[3] || '/';
            if (pathname === '/' || pathname === '/all-events/' || pathname === '/tickets-cart/') return false;
            
            return true;
            
        } catch (error) {
            return false;
        }
    }

    // Normalize URLs
    normalizeUrl(url, baseUrl) {
        if (!url) return null;
        
        // Remove HTML entities
        url = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        // Handle relative URLs
        if (url.startsWith('/')) {
            // Simple URL parsing for Scriptable compatibility
            const urlPattern = /^(https?:)\/\/([^\/]+)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol, host] = match;
                return `${protocol}//${host}${url}`;
            }
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            // Simple URL parsing for Scriptable compatibility
            const urlPattern = /^(https?:)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol] = match;
                return `${protocol}${url}`;
            }
        }
        
        // Handle anchor links (skip them)
        if (url.startsWith('#')) {
            return null;
        }
        
        return url;
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
                        console.log(`🎫 RedEyeTickets: Detected city "${cityKey}" from pattern "${pattern}" in "${searchText}"`);
                        return cityKey;
                    }
                }
            }
        }
        
        console.log(`🎫 RedEyeTickets: No city detected from venue info: "${searchText}"`);
        return null;
    }

    // Extract coordinates from venue information
    extractCoordinates(venueInfo) {
        if (!venueInfo || !venueInfo.address) {
            console.log('🎫 RedEyeTickets: No venue info or address available for coordinates');
            return null;
        }
        
        // No hardcoded coordinates - return null if not found
        // In the future, this could be enhanced with geocoding services
        console.log(`🎫 RedEyeTickets: No coordinates found for address: "${venueInfo.address}"`);
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
                    
                    console.log(`🎫 RedEyeTickets: Got timezone offset for ${timezone}: ${totalOffsetMinutes} minutes`);
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
            
            console.log(`🎫 RedEyeTickets: Converted ${year}-${month+1}-${day} ${hour}:${minute} ${timezone} to UTC: ${utcDate.toISOString()}`);
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
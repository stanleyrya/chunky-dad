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
            maxAdditionalUrls: 10,
            ...config
        };
        
        this.bearKeywords = [
            'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party', 'goldiloxx'
        ];
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

    // Parse individual event from the page
    parseEventFromPage(html, sourceUrl, parserConfig = {}, cityConfig = null) {
        try {
            // Extract title from meta tags or page content
            let title = this.extractTitle(html);
            if (!title) {
                console.warn('🎫 RedEyeTickets: No title found');
                return null;
            }
            
            // Extract date and time
            const dateTime = this.extractDateTime(html);
            if (!dateTime.startDate) {
                console.warn('🎫 RedEyeTickets: No valid date found');
                return null;
            }
            
            // Extract venue and address
            const venueInfo = this.extractVenueInfo(html);
            
            // Extract description
            const description = this.extractDescription(html);
            
            // Extract pricing information
            const pricing = this.extractPricing(html);
            
            // Extract image
            const image = this.extractImage(html);
            
            // Extract city from address or venue info
            const city = this.extractCityFromVenue(venueInfo, cityConfig);
            
            // Get timezone for detected city
            const timezone = city && cityConfig && cityConfig[city] ? cityConfig[city].timezone : null;
            
            // Extract coordinates from venue info
            const coordinates = this.extractCoordinates(venueInfo);
            
            const event = {
                title: title,
                description: description,
                startDate: dateTime.startDate,
                endDate: dateTime.endDate,
                bar: venueInfo.venue,
                location: coordinates ? `${coordinates.lat}, ${coordinates.lng}` : null,
                address: venueInfo.address,
                city: city,
                timezone: timezone,
                url: sourceUrl,
                cover: pricing,
                image: image,
                source: this.config.source,
                isBearEvent: this.config.alwaysBear || this.isBearEvent({
                    title: title,
                    description: description,
                    venue: venueInfo.venue,
                    url: sourceUrl
                })
            };
            
            // Apply source-specific metadata values from config
            if (parserConfig.metadata) {
                Object.keys(parserConfig.metadata).forEach(key => {
                    const metaValue = parserConfig.metadata[key];
                    
                    // Apply value if it exists (source-specific overrides)
                    if (typeof metaValue === 'object' && metaValue !== null && 'value' in metaValue) {
                        event[key] = metaValue.value;
                    }
                });
            }
            
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
    extractDateTime(html) {
        // Look for date pattern: "Saturday, October 25, 2025 at 9pm"
        const dateTimeMatch = html.match(/<p[^>]*><strong>([^<]+)<\/strong>/i);
        if (dateTimeMatch) {
            const dateTimeString = dateTimeMatch[1].trim();
            console.log(`🎫 RedEyeTickets: Found date/time string: "${dateTimeString}"`);
            
            // Parse the date string
            const parsedDate = this.parseRedEyeDateString(dateTimeString);
            if (parsedDate) {
                return parsedDate;
            }
        }
        
        // Fallback: try to extract from meta description
        const metaDescMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
        if (metaDescMatch) {
            const desc = metaDescMatch[1];
            const dateMatch = desc.match(/(\w+\.\s+\d{1,2},?\s+\d{4})/i);
            if (dateMatch) {
                const parsedDate = this.parseRedEyeDateString(dateMatch[1] + ' at 9pm');
                if (parsedDate) {
                    return parsedDate;
                }
            }
        }
        
        return { startDate: null, endDate: null };
    }

    // Parse RedEyeTickets specific date format
    parseRedEyeDateString(dateString) {
        try {
            // Handle format: "Saturday, October 25, 2025 at 9pm"
            const fullMatch = dateString.match(/(\w+),\s+(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+at\s+(\d{1,2})(\w+)/i);
            if (fullMatch) {
                const [, dayOfWeek, month, day, year, hour, ampm] = fullMatch;
                return this.createDateFromComponents(month, day, year, hour, ampm);
            }
            
            // Handle format: "Oct. 25, 2025" (from meta description)
            const shortMatch = dateString.match(/(\w+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
            if (shortMatch) {
                const [, month, day, year] = shortMatch;
                return this.createDateFromComponents(month, day, year, '9', 'pm');
            }
            
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Error parsing date string "${dateString}": ${error}`);
        }
        
        return null;
    }

    // Create date from components
    createDateFromComponents(month, day, year, hour = '9', ampm = 'pm') {
        try {
            const monthMap = {
                'january': '01', 'jan': '01',
                'february': '02', 'feb': '02',
                'march': '03', 'mar': '03',
                'april': '04', 'apr': '04',
                'may': '05',
                'june': '06', 'jun': '06',
                'july': '07', 'jul': '07',
                'august': '08', 'aug': '08',
                'september': '09', 'sep': '09', 'sept': '09',
                'october': '10', 'oct': '10',
                'november': '11', 'nov': '11',
                'december': '12', 'dec': '12'
            };
            
            const monthNum = monthMap[month.toLowerCase()];
            if (!monthNum) {
                console.warn(`🎫 RedEyeTickets: Unknown month: ${month}`);
                return null;
            }
            
            // Convert hour to 24-hour format
            let hour24 = parseInt(hour);
            if (ampm.toLowerCase() === 'pm' && hour24 !== 12) {
                hour24 += 12;
            } else if (ampm.toLowerCase() === 'am' && hour24 === 12) {
                hour24 = 0;
            }
            
            // Create start date
            const startDate = new Date(`${year}-${monthNum}-${day.padStart(2, '0')}T${hour24.toString().padStart(2, '0')}:00:00`);
            
            // Create end date (assume 4am next day if not specified)
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 1);
            endDate.setHours(4, 0, 0, 0);
            
            console.log(`🎫 RedEyeTickets: Created dates - start: ${startDate.toISOString()}, end: ${endDate.toISOString()}`);
            
            return { startDate, endDate };
            
        } catch (error) {
            console.warn(`🎫 RedEyeTickets: Error creating date from components: ${error}`);
            return null;
        }
    }

    // Extract venue information
    extractVenueInfo(html) {
        // Look for venue pattern: "Red Eye NY & The Cockpit- 355 W 41st Street"
        const venueMatch = html.match(/<p[^>]*><strong>[^<]+<\/strong><br>([^<]+)<\/p>/i);
        if (venueMatch) {
            const venueText = venueMatch[1].trim();
            console.log(`🎫 RedEyeTickets: Found venue text: "${venueText}"`);
            
            // Split venue name and address
            const parts = venueText.split('-');
            if (parts.length >= 2) {
                const venue = parts[0].trim();
                const address = parts.slice(1).join('-').trim();
                return { venue, address };
            }
        }
        
        // No fallback - return null if venue info not found
        console.log('🎫 RedEyeTickets: No venue information found in page');
        return { venue: null, address: null };
    }

    // Extract description
    extractDescription(html) {
        // First try to get description from meta tags (most reliable)
        const metaDescMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
        if (metaDescMatch) {
            const metaDesc = metaDescMatch[1].trim();
            if (metaDesc && metaDesc.length > 20) {
                console.log(`🎫 RedEyeTickets: Found description in meta tags: "${metaDesc}"`);
                return metaDesc;
            }
        }
        
        // Try to get description from og:description
        const ogDescMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
        if (ogDescMatch) {
            const ogDesc = ogDescMatch[1].trim();
            if (ogDesc && ogDesc.length > 20) {
                console.log(`🎫 RedEyeTickets: Found description in og:description: "${ogDesc}"`);
                return ogDesc;
            }
        }
        
        // Look for the main description paragraph with GOLDILOXX content
        const descMatch = html.match(/<p[^>]*class="has-text-align-center"[^>]*>([^<]+(?:<br[^>]*>[^<]+)*)<\/p>/i);
        if (descMatch) {
            let description = descMatch[1]
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/&amp;/g, '&')
                .replace(/\s+/g, ' ')
                .trim();
            
            // Look for the full description that includes the bear party text
            if (description.includes('GOLDILOXX') && description.includes('bear party')) {
                console.log(`🎫 RedEyeTickets: Found description in paragraph: "${description}"`);
                return description;
            }
        }
        
        // Try to get the full description from multiple paragraphs
        const fullDescMatch = html.match(/<p[^>]*class="has-text-align-center"[^>]*>([^<]+(?:<br[^>]*>[^<]+)*)<\/p>.*?<p[^>]*class="has-text-align-center"[^>]*>([^<]+(?:<br[^>]*>[^<]+)*)<\/p>/is);
        if (fullDescMatch) {
            let description = (fullDescMatch[1] + ' ' + fullDescMatch[2])
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/&amp;/g, '&')
                .replace(/\s+/g, ' ')
                .trim();
            
            if (description && description.length > 20) {
                console.log(`🎫 RedEyeTickets: Found description in multiple paragraphs: "${description}"`);
                return description;
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
            
            if (uniquePrices.length === 1) {
                return uniquePrices[0];
            } else {
                return `${uniquePrices[0]} - ${uniquePrices[uniquePrices.length - 1]}`;
            }
        }
        
        return '';
    }

    // Extract image URL
    extractImage(html) {
        // Try og:image first
        const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
        if (ogImageMatch) {
            return ogImageMatch[1].trim();
        }
        
        // Try featured image
        const imgMatch = html.match(/<img[^>]*class="[^"]*wp-post-image[^"]*"[^>]*src="([^"]+)"/i);
        if (imgMatch) {
            return imgMatch[1].trim();
        }
        
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

    // Check if an event is a bear event based on keywords
    isBearEvent(event) {
        const title = event.title || '';
        const description = event.description || '';
        const venue = event.venue || '';
        const url = event.url || '';

        // Check if the title, description, venue, or URL contains bear keywords
        if (this.bearKeywords.some(keyword => 
            title.toLowerCase().includes(keyword) || 
            description.toLowerCase().includes(keyword) || 
            venue.toLowerCase().includes(keyword) || 
            url.toLowerCase().includes(keyword)
        )) {
            return true;
        }

        return false;
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
        if (!venueInfo || !venueInfo.address) return null;
        
        // For now, only handle the known NYC venue
        // This can be extended to support other venues as needed
        if (venueInfo.address.includes('355 W 41st Street') || 
            venueInfo.address.includes('355 W 41st St')) {
            return {
                lat: 40.755988,
                lng: -73.988903
            };
        }
        
        console.log(`🎫 RedEyeTickets: No coordinates available for address: "${venueInfo.address}"`);
        return null;
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
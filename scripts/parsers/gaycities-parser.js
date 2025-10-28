// ============================================================================
// GAYCITIES PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
// ✅ Gaycities-specific bar data extraction logic
// ✅ Address, coordinates, Facebook, Google Maps URL extraction
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

class GaycitiesParser {
    constructor(config = {}) {
        this.config = {
            source: 'gaycities',
            maxAdditionalUrls: 20,
            ...config
        };
        
        this.bearKeywords = [
            'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party'
        ];
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🏳️‍🌈 Gaycities: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Parse bar data from gaycities page
            const barEvent = this.parseBarPage(html, htmlData.url, cityConfig);
            if (barEvent) {
                events.push(barEvent);
            }
            
            // Extract additional URLs if urlDiscoveryDepth > 0
            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            }
            
            console.log(`🏳️‍🌈 Gaycities: Found ${events.length} bar events, ${additionalLinks.length} additional links`);
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🏳️‍🌈 Gaycities: Error parsing bar data: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Parse individual bar page from gaycities
    parseBarPage(html, sourceUrl, cityConfig) {
        try {
            console.log(`🏳️‍🌈 Gaycities: Parsing bar page: ${sourceUrl}`);
            
            // Extract bar name from page title or heading
            const barName = this.extractBarName(html);
            if (!barName) {
                console.warn('🏳️‍🌈 Gaycities: No bar name found');
                return null;
            }
            
            // Extract address information
            const addressInfo = this.extractAddressInfo(html);
            
            // Extract coordinates if available
            const coordinates = this.extractCoordinates(html);
            
            // Extract contact information
            const contactInfo = this.extractContactInfo(html);
            
            // Extract description and details
            const description = this.extractDescription(html);
            
            // Extract images
            const images = this.extractImages(html);
            
            // Generate Google Maps URL
            const gmapsUrl = this.generateGoogleMapsUrl(barName, addressInfo.address);
            
            // Extract city from address or URL
            const city = this.extractCityFromAddress(addressInfo.address, cityConfig);
            
            // Create event object (bars are treated as ongoing "events")
            const event = {
                title: barName,
                description: description,
                startDate: null, // Bars don't have specific start dates
                endDate: null,
                bar: barName,
                location: coordinates ? `${coordinates.lat}, ${coordinates.lng}` : null,
                address: addressInfo.address,
                city: city,
                url: sourceUrl,
                gmaps: gmapsUrl,
                facebook: contactInfo.facebook,
                instagram: contactInfo.instagram,
                website: contactInfo.website,
                phone: contactInfo.phone,
                image: images.primary || '',
                cover: images.cover || '',
                source: this.config.source,
                isBearEvent: this.isBearEvent(barName, description)
            };
            
            console.log(`🏳️‍🌈 Gaycities: Successfully parsed bar: ${barName}`);
            return event;
            
        } catch (error) {
            console.error(`🏳️‍🌈 Gaycities: Error parsing bar page: ${error}`);
            return null;
        }
    }

    // Extract bar name from various possible locations
    extractBarName(html) {
        const namePatterns = [
            // Page title patterns
            /<title[^>]*>([^<]+)\s*-\s*GayCities/i,
            /<title[^>]*>([^<]+)\s*-\s*Bars/i,
            /<title[^>]*>([^<]+)\s*-\s*[^<]+<\/title>/i,
            
            // H1 heading patterns
            /<h1[^>]*class="[^"]*venue-name[^>]*>([^<]+)<\/h1>/i,
            /<h1[^>]*class="[^"]*bar-name[^>]*>([^<]+)<\/h1>/i,
            /<h1[^>]*>([^<]+)<\/h1>/i,
            
            // Meta description patterns
            /<meta[^>]*name="description"[^>]*content="([^"]+)"[^>]*>/i,
            
            // JSON-LD structured data
            /"name"\s*:\s*"([^"]+)"/i,
            
            // Common venue name patterns
            /class="[^"]*venue-title[^>]*>([^<]+)</i,
            /class="[^"]*bar-title[^>]*>([^<]+)</i,
            /class="[^"]*location-name[^>]*>([^<]+)</i
        ];
        
        for (const pattern of namePatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                let name = match[1].trim();
                // Clean up common suffixes
                name = name.replace(/\s*-\s*GayCities.*$/i, '');
                name = name.replace(/\s*-\s*Bars.*$/i, '');
                name = name.replace(/\s*-\s*New York.*$/i, '');
                name = name.replace(/\s*-\s*NYC.*$/i, '');
                
                if (name.length > 2) {
                    console.log(`🏳️‍🌈 Gaycities: Found bar name: "${name}"`);
                    return name;
                }
            }
        }
        
        return null;
    }

    // Extract comprehensive address information
    extractAddressInfo(html) {
        const addressInfo = {
            address: null,
            street: null,
            city: null,
            state: null,
            zip: null,
            country: null
        };
        
        // Try to extract from structured data first
        const structuredAddress = this.extractStructuredAddress(html);
        if (structuredAddress) {
            return structuredAddress;
        }
        
        // Fallback to pattern matching
        const addressPatterns = [
            // Common address patterns
            /(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/i,
            /(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})/i,
            /class="[^"]*address[^>]*>([^<]+)</i,
            /class="[^"]*location-address[^>]*>([^<]+)</i,
            /class="[^"]*venue-address[^>]*>([^<]+)</i,
            /data-address="([^"]+)"/i,
            /address="([^"]+)"/i,
            // Look for address in paragraph tags
            /<p[^>]*>(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})<\/p>/i
        ];
        
        for (const pattern of addressPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                let address = match[1].trim();
                // Clean HTML entities
                address = address.replace(/&nbsp;/g, ' ')
                               .replace(/&amp;/g, '&')
                               .replace(/&lt;/g, '<')
                               .replace(/&gt;/g, '>')
                               .replace(/&quot;/g, '"')
                               .replace(/\s+/g, ' ')
                               .trim();
                
                // Basic validation - should look like a real address
                if (address.length > 10 && /\d/.test(address)) {
                    addressInfo.address = address;
                    console.log(`🏳️‍🌈 Gaycities: Found address: "${address}"`);
                    break;
                }
            }
        }
        
        return addressInfo;
    }

    // Extract structured address from JSON-LD or microdata
    extractStructuredAddress(html) {
        try {
            // Look for JSON-LD structured data
            const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;
            const jsonLdMatch = html.match(jsonLdPattern);
            
            if (jsonLdMatch) {
                for (const jsonStr of jsonLdMatch) {
                    try {
                        const jsonData = JSON.parse(jsonStr.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/, '').replace(/<\/script>/, ''));
                        
                        if (jsonData.address) {
                            const addr = jsonData.address;
                            let fullAddress = '';
                            
                            if (typeof addr === 'string') {
                                fullAddress = addr;
                            } else if (typeof addr === 'object') {
                                const parts = [];
                                if (addr.streetAddress) parts.push(addr.streetAddress);
                                if (addr.addressLocality) parts.push(addr.addressLocality);
                                if (addr.addressRegion) parts.push(addr.addressRegion);
                                if (addr.postalCode) parts.push(addr.postalCode);
                                fullAddress = parts.join(', ');
                            }
                            
                            if (fullAddress) {
                                console.log(`🏳️‍🌈 Gaycities: Found structured address: "${fullAddress}"`);
                                return { address: fullAddress };
                            }
                        }
                    } catch (e) {
                        // Continue to next JSON-LD block
                    }
                }
            }
        } catch (error) {
            console.warn(`🏳️‍🌈 Gaycities: Error parsing structured address: ${error}`);
        }
        
        return null;
    }

    // Extract coordinates from various sources
    extractCoordinates(html) {
        const coordPatterns = [
            // Google Maps embed patterns
            /@(-?\d+\.\d+),(-?\d+\.\d+)/,
            // Data attributes
            /data-lat="([^"]+)"[^>]*data-lng="([^"]+)"/i,
            /data-latitude="([^"]+)"[^>]*data-longitude="([^"]+)"/i,
            // JSON-LD coordinates
            /"latitude"\s*:\s*"([^"]+)"[^>]*"longitude"\s*:\s*"([^"]+)"/i,
            /"lat"\s*:\s*"([^"]+)"[^>]*"lng"\s*:\s*"([^"]+)"/i
        ];
        
        for (const pattern of coordPatterns) {
            const match = html.match(pattern);
            if (match && match[1] && match[2]) {
                const lat = parseFloat(match[1]);
                const lng = parseFloat(match[2]);
                
                if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    console.log(`🏳️‍🌈 Gaycities: Found coordinates: ${lat}, ${lng}`);
                    return { lat, lng };
                }
            }
        }
        
        return null;
    }

    // Extract contact information (Facebook, Instagram, website, phone)
    extractContactInfo(html) {
        const contactInfo = {
            facebook: null,
            instagram: null,
            website: null,
            phone: null
        };
        
        // Extract Facebook URL
        const facebookPatterns = [
            /href="(https?:\/\/[^"]*facebook\.com\/[^"]*)"[^>]*>/i,
            /facebook\.com\/([^"'\s]+)/i
        ];
        
        for (const pattern of facebookPatterns) {
            const match = html.match(pattern);
            if (match) {
                let fbUrl = match[1];
                if (!fbUrl.startsWith('http')) {
                    fbUrl = `https://www.facebook.com/${fbUrl}`;
                }
                contactInfo.facebook = fbUrl;
                console.log(`🏳️‍🌈 Gaycities: Found Facebook: ${fbUrl}`);
                break;
            }
        }
        
        // Extract Instagram URL
        const instagramPatterns = [
            /href="(https?:\/\/[^"]*instagram\.com\/[^"]*)"[^>]*>/i,
            /instagram\.com\/([^"'\s]+)/i
        ];
        
        for (const pattern of instagramPatterns) {
            const match = html.match(pattern);
            if (match) {
                let igUrl = match[1];
                if (!igUrl.startsWith('http')) {
                    igUrl = `https://www.instagram.com/${igUrl}`;
                }
                contactInfo.instagram = igUrl;
                console.log(`🏳️‍🌈 Gaycities: Found Instagram: ${igUrl}`);
                break;
            }
        }
        
        // Extract website URL
        const websitePatterns = [
            /href="(https?:\/\/[^"]*)"[^>]*class="[^"]*website/i,
            /href="(https?:\/\/[^"]*)"[^>]*class="[^"]*homepage/i,
            /href="(https?:\/\/[^"]*)"[^>]*class="[^"]*official/i
        ];
        
        for (const pattern of websitePatterns) {
            const match = html.match(pattern);
            if (match && match[1] && !match[1].includes('facebook.com') && !match[1].includes('instagram.com')) {
                contactInfo.website = match[1];
                console.log(`🏳️‍🌈 Gaycities: Found website: ${match[1]}`);
                break;
            }
        }
        
        // Extract phone number
        const phonePatterns = [
            /href="tel:([^"]+)"/i,
            /(\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})/i,
            /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/i
        ];
        
        for (const pattern of phonePatterns) {
            const match = html.match(pattern);
            if (match) {
                let phone = match[1].replace(/[^\d+()-]/g, '');
                if (phone.length >= 10) {
                    contactInfo.phone = phone;
                    console.log(`🏳️‍🌈 Gaycities: Found phone: ${phone}`);
                    break;
                }
            }
        }
        
        return contactInfo;
    }

    // Extract description and details
    extractDescription(html) {
        const descPatterns = [
            /<meta[^>]*name="description"[^>]*content="([^"]+)"[^>]*>/i,
            /class="[^"]*description[^>]*>([^<]+)</i,
            /class="[^"]*details[^>]*>([^<]+)</i,
            /class="[^"]*summary[^>]*>([^<]+)</i,
            /<p[^>]*class="[^"]*intro[^>]*>([^<]+)<\/p>/i
        ];
        
        for (const pattern of descPatterns) {
            const match = html.match(pattern);
            if (match && match[1] && match[1].trim().length > 20) {
                let desc = match[1].trim();
                // Clean HTML entities
                desc = desc.replace(/&nbsp;/g, ' ')
                          .replace(/&amp;/g, '&')
                          .replace(/&lt;/g, '<')
                          .replace(/&gt;/g, '>')
                          .replace(/&quot;/g, '"')
                          .replace(/\s+/g, ' ')
                          .trim();
                
                console.log(`🏳️‍🌈 Gaycities: Found description: "${desc.substring(0, 100)}..."`);
                return desc;
            }
        }
        
        return null;
    }

    // Extract images
    extractImages(html) {
        const images = {
            primary: null,
            cover: null
        };
        
        const imagePatterns = [
            /<img[^>]*src="([^"]*)"[^>]*class="[^"]*main[^>]*>/i,
            /<img[^>]*src="([^"]*)"[^>]*class="[^"]*hero[^>]*>/i,
            /<img[^>]*src="([^"]*)"[^>]*class="[^"]*featured[^>]*>/i,
            /<img[^>]*src="([^"]*)"[^>]*class="[^"]*venue[^>]*>/i,
            /<img[^>]*src="([^"]*)"[^>]*class="[^"]*bar[^>]*>/i
        ];
        
        for (const pattern of imagePatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                let imgUrl = match[1];
                if (imgUrl.startsWith('//')) {
                    imgUrl = 'https:' + imgUrl;
                } else if (imgUrl.startsWith('/')) {
                    imgUrl = 'https://www.gaycities.com' + imgUrl;
                }
                
                if (!images.primary) {
                    images.primary = imgUrl;
                    console.log(`🏳️‍🌈 Gaycities: Found primary image: ${imgUrl}`);
                } else if (!images.cover) {
                    images.cover = imgUrl;
                    console.log(`🏳️‍🌈 Gaycities: Found cover image: ${imgUrl}`);
                    break;
                }
            }
        }
        
        return images;
    }

    // Generate Google Maps URL
    generateGoogleMapsUrl(barName, address) {
        if (!barName || !address) {
            return null;
        }
        
        try {
            // Clean the bar name and address for URL encoding
            const cleanBarName = barName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '+');
            const cleanAddress = address.replace(/[^\w\s,-]/g, '').replace(/\s+/g, '+');
            
            // Create Google Maps search URL
            const searchQuery = `${cleanBarName}+${cleanAddress}`;
            const gmapsUrl = `https://www.google.com/maps/search/${searchQuery}`;
            
            console.log(`🏳️‍🌈 Gaycities: Generated Google Maps URL: ${gmapsUrl}`);
            return gmapsUrl;
            
        } catch (error) {
            console.warn(`🏳️‍🌈 Gaycities: Error generating Google Maps URL: ${error}`);
            return null;
        }
    }

    // Extract city from address or URL
    extractCityFromAddress(address, cityConfig) {
        if (!address || !cityConfig) return null;
        
        const searchText = address.toLowerCase();
        
        // Check each city's patterns
        for (const [cityKey, cityData] of Object.entries(cityConfig)) {
            if (cityData.patterns && Array.isArray(cityData.patterns)) {
                for (const pattern of cityData.patterns) {
                    if (searchText.includes(pattern.toLowerCase())) {
                        console.log(`🏳️‍🌈 Gaycities: Detected city: ${cityKey} from address: "${address}"`);
                        return cityKey;
                    }
                }
            }
        }
        
        return null;
    }

    // Check if this is a bear event based on name and description
    isBearEvent(barName, description) {
        const searchText = `${barName || ''} ${description || ''}`.toLowerCase();
        
        return this.bearKeywords.some(keyword => 
            searchText.includes(keyword.toLowerCase())
        );
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            console.log(`🏳️‍🌈 Gaycities: Extracting additional bar URLs`);
            
            // Look for links to other bars or venues
            const linkPatterns = [
                /href="(\/[^"]*\/bars\/[^"]+)"/gi,
                /href="(\/[^"]*\/venues\/[^"]+)"/gi,
                /href="(\/[^"]*\/nightlife\/[^"]+)"/gi
            ];
            
            for (const pattern of linkPatterns) {
                let match;
                let matchCount = 0;
                
                while ((match = pattern.exec(html)) !== null && matchCount < 10) {
                    const url = this.normalizeUrl(match[1], sourceUrl);
                    if (this.isValidBarUrl(url, sourceUrl)) {
                        urls.add(url);
                        matchCount++;
                    }
                }
            }
            
            console.log(`🏳️‍🌈 Gaycities: Extracted ${urls.size} additional bar URLs`);
            
        } catch (error) {
            console.warn(`🏳️‍🌈 Gaycities: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls);
    }

    // Validate if URL is a valid bar URL
    isValidBarUrl(url, sourceUrl) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            // Should be from gaycities.com
            if (!url.includes('gaycities.com')) return false;
            
            // Should be a bar or venue page
            if (!url.includes('/bars/') && !url.includes('/venues/') && !url.includes('/nightlife/')) {
                return false;
            }
            
            // Avoid admin, login, or non-bar pages
            const invalidPaths = [
                '/admin', '/login', '/wp-admin', '/wp-login', '/user/', '/profile/',
                '#', 'javascript:', 'mailto:', 'tel:', 'sms:',
                '/events/', '/calendar/', '/listings/'
            ];
            
            if (invalidPaths.some(invalid => url.toLowerCase().includes(invalid))) return false;
            
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
            const urlPattern = /^(https?:)\/\/([^\/]+)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol, host] = match;
                return `${protocol}//${host}${url}`;
            }
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
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
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GaycitiesParser };
} else if (typeof window !== 'undefined') {
    window.GaycitiesParser = GaycitiesParser;
} else {
    // Scriptable environment
    this.GaycitiesParser = GaycitiesParser;
}
// ============================================================================
// GENERIC PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
// ✅ Generic venue extraction logic that works for most websites
// ✅ Date/time parsing and formatting
// ✅ Event object creation and validation
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Environment detection (typeof importModule, typeof window, typeof DOMParser)
// ❌ HTTP requests (receive HTML data, don't fetch it)
// ❌ Calendar operations (return event objects, don't save them)
// ❌ Scriptable APIs (Request, Calendar, FileManager, Alert)
// ❌ DOM APIs (DOMParser, document, window) - use regex instead
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class GenericParser {
    constructor(config = {}) {
        this.config = {
            source: 'generic',
            requireDetailPages: true,
            maxAdditionalUrls: 15,
            ...config
        };
        
        this.bearKeywords = [
            'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party'
        ];
        
        // Shared city utilities will be injected by shared-core
        this.sharedCore = null;
    }
    
    // Initialize with shared-core instance for city utilities
    initialize(sharedCore) {
        this.sharedCore = sharedCore;
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}) {
        try {
            console.log(`🔧 Generic: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🔧 Generic: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Parse HTML using regex (works in all environments)
            const htmlEvents = this.parseHTMLEvents(html, htmlData.url);
            events.push(...htmlEvents);
            
            // Extract additional URLs if required
            let additionalLinks = [];
            if (parserConfig.requireDetailPages) {
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            }
            
            console.log(`🔧 Generic: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🔧 Generic: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Parse HTML events using regex (environment-agnostic)
    parseHTMLEvents(html, sourceUrl) {
        const events = [];
        
        try {
            // Generic event patterns that work for most websites
            const eventPatterns = [
                // Event containers with common class names
                /<div[^>]*class="[^"]*event[^>]*>.*?<\/div>/gs,
                /<div[^>]*class="[^"]*party[^>]*>.*?<\/div>/gs,
                /<div[^>]*class="[^"]*show[^>]*>.*?<\/div>/gs,
                /<div[^>]*class="[^"]*listing[^>]*>.*?<\/div>/gs,
                // Article and post containers
                /<article[^>]*>.*?<\/article>/gs,
                /<div[^>]*class="[^"]*post[^>]*>.*?<\/div>/gs,
                /<div[^>]*class="[^"]*entry[^>]*>.*?<\/div>/gs,
                // List items that might contain events
                /<li[^>]*class="[^"]*event[^>]*>.*?<\/li>/gs,
                /<li[^>]*class="[^"]*party[^>]*>.*?<\/li>/gs
            ];
            
            for (const pattern of eventPatterns) {
                const matches = html.match(pattern) || [];
                
                for (const match of matches) {
                    try {
                        const event = this.parseHTMLEventElement(match, sourceUrl);
                        if (event) {
                            events.push(event);
                        }
                    } catch (error) {
                        console.warn(`🔧 Generic: Failed to parse HTML event element: ${error}`);
                    }
                }
                
                if (events.length > 0) {
                    console.log(`🔧 Generic: Found ${events.length} events using HTML pattern`);
                    break;
                }
            }
            
        } catch (error) {
            console.warn(`🔧 Generic: Error parsing HTML events: ${error}`);
        }
        
        return events;
    }

    // Parse individual HTML event element
    parseHTMLEventElement(htmlElement, sourceUrl) {
        try {
            // Extract title using multiple possible patterns
            const titlePatterns = [
                /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/,
                /class="[^"]*title[^>]*>([^<]+)</,
                /class="[^"]*event-title[^>]*>([^<]+)</,
                /class="[^"]*party-title[^>]*>([^<]+)</,
                /class="[^"]*show-title[^>]*>([^<]+)</,
                /class="[^"]*name[^>]*>([^<]+)</,
                /<strong[^>]*>([^<]+)<\/strong>/,
                /<b[^>]*>([^<]+)<\/b>/
            ];
            
            let title = '';
            for (const pattern of titlePatterns) {
                const match = htmlElement.match(pattern);
                if (match && match[1].trim()) {
                    title = match[1].trim();
                    break;
                }
            }
            
            if (!title) {
                title = 'Untitled Event';
            }
            
            // Extract date/time using multiple patterns
            const datePatterns = [
                /class="[^"]*date[^>]*>([^<]+)</,
                /class="[^"]*event-date[^>]*>([^<]+)</,
                /class="[^"]*datetime[^>]*>([^<]+)</,
                /datetime="([^"]+)"/,
                /data-date="([^"]+)"/,
                /(\d{1,2}\/\d{1,2}\/\d{4})/,
                /(\d{4}-\d{2}-\d{2})/,
                /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i
            ];
            
            let dateString = '';
            for (const pattern of datePatterns) {
                const match = htmlElement.match(pattern);
                if (match && match[1]) {
                    dateString = match[1].trim();
                    break;
                }
            }
            
            const startDate = this.parseDate(dateString);
            
            // Extract venue/location
            const venuePatterns = [
                /class="[^"]*venue[^>]*>([^<]+)</,
                /class="[^"]*location[^>]*>([^<]+)</,
                /class="[^"]*event-venue[^>]*>([^<]+)</,
                /class="[^"]*address[^>]*>([^<]+)</,
                /class="[^"]*place[^>]*>([^<]+)</
            ];
            
            let venue = '';
            for (const pattern of venuePatterns) {
                const match = htmlElement.match(pattern);
                if (match && match[1].trim()) {
                    venue = match[1].trim();
                    break;
                }
            }
            
            // Extract description
            const descPatterns = [
                /class="[^"]*description[^>]*>([^<]+)</,
                /class="[^"]*details[^>]*>([^<]+)</,
                /class="[^"]*summary[^>]*>([^<]+)</,
                /class="[^"]*content[^>]*>([^<]+)</,
                /<p[^>]*>([^<]+)<\/p>/
            ];
            
            let description = '';
            for (const pattern of descPatterns) {
                const match = htmlElement.match(pattern);
                if (match && match[1].trim()) {
                    description = match[1].trim();
                    break;
                }
            }
            
            // Extract URL if available
            const urlMatch = htmlElement.match(/href="([^"]+)"/) ||
                            htmlElement.match(/data-url="([^"]+)"/);
            
            const eventUrl = urlMatch ? this.normalizeUrl(urlMatch[1], sourceUrl) : sourceUrl;
            
            // Extract price if available
            const pricePatterns = [
                /class="[^"]*price[^>]*>([^<]+)</,
                /class="[^"]*cost[^>]*>([^<]+)</,
                /\$(\d+(?:\.\d{2})?)/,
                /(free|gratis|no charge)/i
            ];
            
            let price = '';
            for (const pattern of pricePatterns) {
                const match = htmlElement.match(pattern);
                if (match && match[1]) {
                    price = match[1].trim();
                    break;
                }
            }
            
            // Extract city from text
            const city = this.sharedCore ? 
                this.sharedCore.extractCityFromText(title + ' ' + venue + ' ' + description + ' ' + eventUrl) :
                this.extractCityFromText(title + ' ' + venue + ' ' + description + ' ' + eventUrl);
            
            const event = {
                title: title,
                description: description,
                startDate: startDate,
                endDate: null,
                venue: venue,
                city: city,
                url: eventUrl,
                price: price,
                image: '',
                source: this.config.source,
                isBearEvent: false // Will be filtered later based on keywords
            };
            
            // Apply all metadata fields from config
            if (parserConfig.metadata) {
                // Pass through all metadata fields to the event
                Object.keys(parserConfig.metadata).forEach(key => {
                    const metaValue = parserConfig.metadata[key];
                    
                    // All fields must use {value, merge} format
                    if (typeof metaValue === 'object' && metaValue !== null && 'merge' in metaValue) {
                        // Only set value if it's defined (allows preserve without value)
                        if ('value' in metaValue && metaValue.value !== undefined) {
                            event[key] = metaValue.value;
                        }
                        
                        // Store merge strategy for later use
                        if (!event._fieldMergeStrategies) {
                            event._fieldMergeStrategies = {};
                        }
                        event._fieldMergeStrategies[key] = metaValue.merge || 'preserve';
                    }
                    // Ignore non-object values since we require explicit format
                });
            }
            
            return event;
            
        } catch (error) {
            console.warn(`🔧 Generic: Failed to parse HTML event element: ${error}`);
            return null;
        }
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            // Use configured URL patterns or defaults
            const patterns = parserConfig.urlPatterns || this.urlPatterns;
            
            for (const pattern of patterns) {
                const regex = new RegExp(pattern.regex, 'gi');
                let match;
                let matchCount = 0;
                
                while ((match = regex.exec(html)) !== null && matchCount < (pattern.maxMatches || 10)) {
                    const url = this.normalizeUrl(match[1], sourceUrl);
                    if (this.isValidEventUrl(url, sourceUrl)) {
                        urls.add(url);
                        matchCount++;
                    }
                }
            }
            
            console.log(`🔧 Generic: Extracted ${urls.size} additional URLs`);
            
        } catch (error) {
            console.warn(`🔧 Generic: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls);
    }

    // Validate if URL is a valid event URL
    isValidEventUrl(url, sourceUrl) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            const urlObj = new URL(url);
            const sourceObj = new URL(sourceUrl);
            
            // Should be from the same domain or subdomain
            if (!urlObj.hostname.includes(sourceObj.hostname) && 
                !sourceObj.hostname.includes(urlObj.hostname)) return false;
            
            // Avoid admin, login, or social media links
            const invalidPaths = [
                '/admin', '/login', '/wp-admin', '/wp-login', '/user/', '/profile/',
                '#', 'javascript:', 'mailto:', 'tel:', 'sms:',
                'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com'
            ];
            
            if (invalidPaths.some(invalid => url.toLowerCase().includes(invalid))) return false;
            
            // Should contain event-related keywords in the path
            const eventKeywords = ['event', 'party', 'show', 'calendar', 'listing'];
            const hasEventKeyword = eventKeywords.some(keyword => 
                urlObj.pathname.toLowerCase().includes(keyword)
            );
            
            return hasEventKeyword;
            
        } catch (error) {
            return false;
        }
    }

    // Extract city from text content
    extractCityFromText(text) {
        if (!this.sharedCore) {
            console.warn('🔧 Generic: SharedCore not initialized, cannot extract city.');
            return null;
        }
        return this.sharedCore.extractCityFromText(text);
    }

    // Parse date string into ISO format
    parseDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Clean up the date string
            dateString = dateString.replace(/\s+/g, ' ').trim();
            
            // Try various date formats common in event listings
            const formats = [
                // MM/DD/YYYY
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
                // MM-DD-YYYY
                /(\d{1,2})-(\d{1,2})-(\d{4})/,
                // YYYY-MM-DD (ISO format)
                /(\d{4})-(\d{2})-(\d{2})/,
                // Month DD, YYYY
                /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i,
                // DD Month YYYY
                /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i
            ];
            
            for (const format of formats) {
                const match = dateString.match(format);
                if (match) {
                    let date;
                    
                    if (format.source.includes('january|february')) {
                        // Month name format
                        const months = {
                            'january': '01', 'february': '02', 'march': '03', 'april': '04',
                            'may': '05', 'june': '06', 'july': '07', 'august': '08',
                            'september': '09', 'october': '10', 'november': '11', 'december': '12'
                        };
                        
                        if (match[3]) {
                            // Month DD, YYYY format
                            const month = months[match[1].toLowerCase()];
                            const day = match[2].padStart(2, '0');
                            const year = match[3];
                            date = new Date(`${year}-${month}-${day}`);
                        } else {
                            // DD Month YYYY format
                            const day = match[1].padStart(2, '0');
                            const month = months[match[2].toLowerCase()];
                            const year = match[3];
                            date = new Date(`${year}-${month}-${day}`);
                        }
                    } else if (match[3] && match[3].length === 4) {
                        // YYYY-MM-DD format
                        date = new Date(`${match[1]}-${match[2]}-${match[3]}`);
                    } else {
                        // MM/DD/YYYY or MM-DD-YYYY format
                        const month = match[1].padStart(2, '0');
                        const day = match[2].padStart(2, '0');
                        const year = match[3];
                        date = new Date(`${year}-${month}-${day}`);
                    }
                    
                    if (!isNaN(date.getTime())) {
                        return date.toISOString();
                    }
                }
            }
            
            // Fallback to Date constructor
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                return date.toISOString();
            }
            
        } catch (error) {
            console.warn(`🔧 Generic: Failed to parse date "${dateString}": ${error}`);
        }
        
        return null;
    }

    // Normalize URLs
    normalizeUrl(url, baseUrl) {
        if (!url) return null;
        
        // Remove HTML entities
        url = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        // Handle relative URLs
        if (url.startsWith('/')) {
            const base = new URL(baseUrl);
            return `${base.protocol}//${base.host}${url}`;
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            const base = new URL(baseUrl);
            return `${base.protocol}${url}`;
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
    module.exports = { GenericParser };
} else if (typeof window !== 'undefined') {
    window.GenericParser = GenericParser;
} else {
    // Scriptable environment
    this.GenericParser = GenericParser;
}
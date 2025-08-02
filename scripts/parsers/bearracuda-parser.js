// ============================================================================
// BEARRACUDA PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
// ✅ Venue-specific extraction logic
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

class BearraccudaParser {
    constructor(config = {}) {
        this.config = {
            source: 'bearracuda',
            requireDetailPages: false,
            maxAdditionalUrls: 10,
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
            console.log(`🐻 Bearraccuda: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Bearraccuda: No HTML content to parse');
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
            
            console.log(`🐻 Bearraccuda: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🐻 Bearraccuda: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Parse HTML events using regex (environment-agnostic)
    parseHTMLEvents(html, sourceUrl) {
        const events = [];
        
        try {
            // Bearraccuda-specific event patterns
            const eventPatterns = [
                // Event containers
                /<div[^>]*class="[^"]*event[^>]*>.*?<\/div>/gs,
                /<div[^>]*class="[^"]*party[^>]*>.*?<\/div>/gs,
                /<article[^>]*class="[^"]*event[^>]*>.*?<\/article>/gs,
                /<section[^>]*class="[^"]*event[^>]*>.*?<\/section>/gs,
                // Event cards or listings
                /<div[^>]*class="[^"]*card[^>]*>.*?<\/div>/gs,
                /<li[^>]*class="[^"]*event[^>]*>.*?<\/li>/gs
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
                        console.warn(`🐻 Bearraccuda: Failed to parse HTML event element: ${error}`);
                    }
                }
                
                if (events.length > 0) {
                    console.log(`🐻 Bearraccuda: Found ${events.length} events using HTML pattern`);
                    break;
                }
            }
            
        } catch (error) {
            console.warn(`🐻 Bearraccuda: Error parsing HTML events: ${error}`);
        }
        
        return events;
    }

    // Parse individual HTML event element
    parseHTMLEventElement(htmlElement, sourceUrl) {
        try {
            // Extract title - Bearraccuda often has distinctive naming
            const titleMatch = htmlElement.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/) ||
                              htmlElement.match(/class="[^"]*title[^>]*>([^<]+)</) ||
                              htmlElement.match(/class="[^"]*event-title[^>]*>([^<]+)</) ||
                              htmlElement.match(/class="[^"]*party-title[^>]*>([^<]+)</);
            
            const title = titleMatch ? titleMatch[1].trim() : 'Bearraccuda Event';
            
            // Extract date/time
            const dateMatch = htmlElement.match(/class="[^"]*date[^>]*>([^<]+)</) ||
                             htmlElement.match(/datetime="([^"]+)"/) ||
                             htmlElement.match(/data-date="([^"]+)"/) ||
                             htmlElement.match(/(\d{1,2}\/\d{1,2}\/\d{4})/) ||
                             htmlElement.match(/(\d{4}-\d{2}-\d{2})/);
            
            const dateString = dateMatch ? dateMatch[1].trim() : '';
            const startDate = this.parseDate(dateString);
            
            // Extract venue/location - Bearraccuda parties are often at specific venues
            const venueMatch = htmlElement.match(/class="[^"]*venue[^>]*>([^<]+)</) ||
                              htmlElement.match(/class="[^"]*location[^>]*>([^<]+)</) ||
                              htmlElement.match(/class="[^"]*club[^>]*>([^<]+)</);
            
            const venue = venueMatch ? venueMatch[1].trim() : '';
            
            // Extract description/details
            const descMatch = htmlElement.match(/class="[^"]*description[^>]*>([^<]+)</) ||
                             htmlElement.match(/class="[^"]*details[^>]*>([^<]+)</) ||
                             htmlElement.match(/<p[^>]*>([^<]+)<\/p>/);
            
            const description = descMatch ? descMatch[1].trim() : '';
            
            // Extract DJ/performer info if available
            let performers = '';
            const performerMatch = htmlElement.match(/class="[^"]*dj[^>]*>([^<]+)</) ||
                                  htmlElement.match(/class="[^"]*performer[^>]*>([^<]+)</) ||
                                  htmlElement.match(/class="[^"]*artist[^>]*>([^<]+)</);
            
            if (performerMatch) {
                performers = performerMatch[1].trim();
            }
            
            // Extract URL if available
            const urlMatch = htmlElement.match(/href="([^"]+)"/) ||
                            htmlElement.match(/data-url="([^"]+)"/);
            
            const eventUrl = urlMatch ? this.normalizeUrl(urlMatch[1], sourceUrl) : sourceUrl;
            
            // Extract city from text
            const city = this.sharedCore ? 
                this.sharedCore.extractCityFromText(title + ' ' + venue + ' ' + description + ' ' + eventUrl) :
                this.extractCityFromText(title + ' ' + venue + ' ' + description + ' ' + eventUrl);
            
            // Combine description with performer info
            let fullDescription = description;
            if (performers) {
                fullDescription = fullDescription ? `${fullDescription}\n\nPerformers: ${performers}` : `Performers: ${performers}`;
            }
            
            let event = {
                title: title,
                description: fullDescription,
                startDate: startDate,
                endDate: null,
                venue: venue,
                address: '', // Assuming address is not directly available in this regex
                city: city || 'default',
                url: eventUrl,
                price: '',
                image: '',
                source: this.config.source,
                isBearEvent: true // Bearraccuda events are always bear events
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
            console.warn(`🐻 Bearraccuda: Failed to parse HTML event element: ${error}`);
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
                    if (this.isValidEventUrl(url)) {
                        urls.add(url);
                        matchCount++;
                    }
                }
            }
            
            console.log(`🐻 Bearraccuda: Extracted ${urls.size} additional URLs`);
            
        } catch (error) {
            console.warn(`🐻 Bearraccuda: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls);
    }

    // Validate if URL is a valid event URL
    isValidEventUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            const urlObj = new URL(url);
            
            // Must be Bearraccuda domain or related
            if (!urlObj.hostname.includes('bearracuda.com') && 
                !urlObj.hostname.includes('bearraccuda.com')) return false;
            
            // Avoid admin, login, or social media links
            const invalidPaths = ['/admin', '/login', '/wp-admin', '/wp-login', '#', 'javascript:', 'mailto:'];
            if (invalidPaths.some(invalid => url.includes(invalid))) return false;
            
            return true;
            
        } catch (error) {
            return false;
        }
    }

    // Extract city from text content
    extractCityFromText(text) {
        if (!this.sharedCore) {
            console.warn('🐻 Bearraccuda: Shared core utilities not initialized. Cannot extract city.');
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
                // Month DD, YYYY
                /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i,
                // DD Month YYYY
                /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
                // ISO format
                /(\d{4})-(\d{2})-(\d{2})/
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
                    } else {
                        // Numeric formats
                        date = new Date(dateString);
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
            console.warn(`🐻 Bearraccuda: Failed to parse date "${dateString}": ${error}`);
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
    module.exports = { BearraccudaParser };
} else if (typeof window !== 'undefined') {
    window.BearraccudaParser = BearraccudaParser;
} else {
    // Scriptable environment
    this.BearraccudaParser = BearraccudaParser;
}
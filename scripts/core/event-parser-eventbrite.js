// Event Parser - Eventbrite
// Specialized parser for Eventbrite event website structure
// Works with all Eventbrite events, not just Megawoof

// Prevent duplicate class declaration in browser environment only
if (typeof window !== 'undefined' && typeof EventbriteEventParser !== 'undefined') {
    console.warn('EventbriteEventParser already defined, skipping redefinition');
} else {

class EventbriteEventParser {
    constructor(config = {}) {
        this.config = {
            source: 'Eventbrite',
            baseUrl: 'https://www.eventbrite.com',
            alwaysBear: false,
            requireDetailPages: false,
            maxAdditionalUrls: 20,
            ...config
        };
        
        this.bearKeywords = [
            'megawoof', 'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party'
        ];
    }

    // Parse HTML content from Eventbrite
    parseEvents(htmlData) {
        try {
            console.log(`🐻 Eventbrite: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Eventbrite: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // First try to extract events from embedded JSON data (modern Eventbrite approach)
            const jsonEvents = this.extractEventsFromJson(html);
            if (jsonEvents.length > 0) {
                console.log(`🐻 Eventbrite: Found ${jsonEvents.length} events in embedded JSON data`);
                events.push(...jsonEvents);
                
                return {
                    events: events,
                    additionalLinks: [], // JSON data already contains full event details
                    source: this.config.source,
                    url: htmlData.url
                };
            }
            
            // Fallback to HTML parsing if no JSON data found
            console.log('🐻 Eventbrite: No JSON data found, falling back to HTML parsing');
            
            // Create a temporary DOM element to parse HTML
            let doc;
            const isScriptable = typeof importModule !== 'undefined';
            const isWebBrowser = typeof window !== 'undefined' && typeof DOMParser !== 'undefined';
            
            if (isWebBrowser) {
                // Web browser environment - use DOMParser
                console.log('🐻 Eventbrite: Using DOMParser for web environment');
                const parser = new DOMParser();
                doc = parser.parseFromString(html, 'text/html');
            } else {
                // Scriptable or Node.js environment - use regex-based parsing
                console.log('🐻 Eventbrite: Using Scriptable-compatible HTML parsing');
                doc = this.parseHTMLForScriptable(html);
            }
            
            // Eventbrite-specific selectors - updated for current Eventbrite structure (2025)
            // Try multiple selector strategies to find events
            const selectors = [
                // Modern Eventbrite selectors
                '[data-testid="event-card-tracking-layer"]',
                '[data-testid*="event"]',
                '.search-event-card',
                '.event-card',
                '.event-card-link',
                '.eds-event-card',
                '.eds-event-card-content',
                '[class*="event-card"]',
                '[class*="EventCard"]',
                '[class*="search-event"]',
                // Generic link selectors for event pages
                'a[href*="/e/"]',
                'a[href*="/events/"]',
                // Container selectors that might hold events
                '[class*="Container_root"]',
                '[class*="event"]'
            ];
            
            let eventElements = [];
            let usedSelector = '';
            
            // Try each selector until we find events
            for (const selector of selectors) {
                const elements = doc.querySelectorAll(selector);
                console.log(`🐻 Eventbrite: Trying selector "${selector}" - found ${elements.length} elements`);
                
                if (elements.length > 0) {
                    eventElements = elements;
                    usedSelector = selector;
                    break;
                }
            }
            
            console.log(`🐻 Eventbrite: Using selector "${usedSelector}" - found ${eventElements.length} total elements`);
            
            // Add detailed logging to see what we're actually finding
            if (eventElements.length > 0) {
                eventElements.forEach((element, index) => {
                    const preview = isScriptable ? element.innerHTML?.substring(0, 200) : element.outerHTML?.substring(0, 200);
                    console.log(`🐻 Eventbrite: Element ${index + 1} preview:`, preview);
                });
            } else {
                console.warn('🐻 Eventbrite: No event elements found with any selector');
                
                // Enhanced debugging - show more HTML structure
                console.log(`🐻 Eventbrite: HTML length: ${html ? html.length : 0} characters`);
                
                if (html && html.length > 0) {
                    console.log('🐻 Eventbrite: HTML preview (first 1000 chars):', html.substring(0, 1000));
                    console.log('🐻 Eventbrite: HTML preview (middle section):', html.substring(Math.floor(html.length/2), Math.floor(html.length/2) + 1000));
                    
                    // Check if HTML contains expected Eventbrite patterns
                    const hasEventbriteContent = html.toLowerCase().includes('eventbrite') || 
                                               html.toLowerCase().includes('data-testid') ||
                                               html.toLowerCase().includes('event-card');
                    console.log('🐻 Eventbrite: HTML contains Eventbrite patterns:', hasEventbriteContent);
                } else {
                    console.error('🐻 Eventbrite: HTML is null, undefined, or empty');
                    return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
                }
                
                // Try to find what elements ARE available
                if (!isWebBrowser) {
                    // Look for common Eventbrite patterns in HTML
                    const patterns = [
                        { name: 'div elements', regex: /<div[^>]*>/gi },
                        { name: 'links with /e/', regex: /<a[^>]*href="[^"]*\/e\/[^"]*"[^>]*>/gi },
                        { name: 'data-testid attributes', regex: /data-testid="[^"]*"/gi },
                        { name: 'class attributes with "event"', regex: /class="[^"]*event[^"]*"/gi },
                        { name: 'class attributes with "card"', regex: /class="[^"]*card[^"]*"/gi }
                    ];
                    
                    patterns.forEach(pattern => {
                        const matches = html.match(pattern.regex) || [];
                        console.log(`🐻 Eventbrite: Found ${matches.length} ${pattern.name}`);
                        if (matches.length > 0 && matches.length <= 10) {
                            matches.forEach((match, i) => {
                                console.log(`🐻 Eventbrite: ${pattern.name} ${i + 1}:`, match);
                            });
                        } else if (matches.length > 10) {
                            console.log(`🐻 Eventbrite: First 5 ${pattern.name}:`);
                            matches.slice(0, 5).forEach((match, i) => {
                                console.log(`🐻 Eventbrite: ${pattern.name} ${i + 1}:`, match);
                            });
                        }
                    });
                } else {
                    const allDivs = doc.querySelectorAll('div');
                    const allLinks = doc.querySelectorAll('a');
                    console.log(`🐻 Eventbrite: Found ${allDivs.length} div elements and ${allLinks.length} links in DOM`);
                    
                    // Look for any elements with event-related attributes
                    const eventRelated = doc.querySelectorAll('[class*="event"], [data-testid*="event"], [href*="/e/"]');
                    console.log(`🐻 Eventbrite: Found ${eventRelated.length} event-related elements`);
                    
                    if (eventRelated.length > 0 && eventRelated.length <= 5) {
                        eventRelated.forEach((el, i) => {
                            console.log(`🐻 Eventbrite: Event-related element ${i + 1}:`, el.outerHTML.substring(0, 200));
                        });
                    }
                }
            }
            
            eventElements.forEach((element, index) => {
                try {
                    console.log(`🐻 Eventbrite: Parsing event ${index + 1}/${eventElements.length}`);
                    const event = this.parseEventElement(element, htmlData.url);
                    console.log(`🐻 Eventbrite: Event ${index + 1} parsed:`, {
                        title: event?.title,
                        date: event?.date,
                        hasTitle: !!event?.title,
                        isValidTitle: event?.title && event.title !== 'Untitled Event'
                    });
                    if (event && event.title && event.title !== 'Untitled Event') {
                        // Check if this is from a source that should always be considered bear events
                        if (this.config.alwaysBear) {
                            event.isBearEvent = true;
                            console.log(`🐻 Eventbrite: Event "${event.title}" marked as bear event (alwaysBear config)`);
                        } else {
                            // Fallback to legacy alwaysBear detection for backward compatibility
                            const alwaysBearSources = ['megawoof', 'furball', 'bearraccuda'];
                            const isAlwaysBearSource = alwaysBearSources.some(source => 
                                htmlData.url.toLowerCase().includes(source) || 
                                this.config.source.toLowerCase().includes(source)
                            );
                            
                            if (isAlwaysBearSource) {
                                event.isBearEvent = true;
                                console.log(`🐻 Eventbrite: Event "${event.title}" marked as bear event (legacy always-bear source)`);
                            } else {
                                event.isBearEvent = this.isBearEvent(event);
                                console.log(`🐻 Eventbrite: Event "${event.title}" bear check result: ${event.isBearEvent}`);
                            }
                        }
                        
                        events.push(event);
                        console.log(`🐻 Eventbrite: Added event "${event.title}" (bear event: ${event.isBearEvent})`);
                    } else {
                        console.log(`🐻 Eventbrite: Skipped event ${index + 1} - invalid title`);
                    }
                } catch (error) {
                    console.warn(`🐻 Eventbrite: Failed to parse event ${index}:`, error.message);
                }
            });
            
            // Also look for additional event links
            const additionalLinks = this.extractAdditionalLinks(doc, htmlData.url);
            
            // If we found no events but found additional links, this might be a dynamically loaded page
            // In this case, the additional links are probably the actual events we should process
            if (events.length === 0 && additionalLinks.length > 0) {
                console.log(`🐻 Eventbrite: No events found in main HTML, but found ${additionalLinks.length} event links. This appears to be a dynamically loaded page.`);
                console.log(`🐻 Eventbrite: Event links found:`, additionalLinks.slice(0, 5));
                
                // Create placeholder events from the links we found
                // These will be processed later when the links are followed
                additionalLinks.forEach((link, index) => {
                    const eventId = this.extractEventId(link);
                    if (eventId) {
                        const placeholderEvent = {
                            id: eventId,
                            title: `Event ${eventId}`,
                            url: link,
                            source: this.config.source,
                            timestamp: new Date().toISOString(),
                            isPlaceholder: true,
                            isBearEvent: true, // Assume bear event for Megawoof organizer
                            requiresDetailFetch: this.config.requireDetailPages
                        };
                        events.push(placeholderEvent);
                        console.log(`🐻 Eventbrite: Created placeholder event for ${link}`);
                    }
                });
            }
            
            console.log(`🐻 Eventbrite: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events,
                additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error('🐻 Eventbrite: Error parsing events:', error);
            console.error('🐻 Eventbrite: Error details:', {
                message: error.message,
                stack: error.stack,
                htmlLength: html ? html.length : 0,
                url: htmlData.url
            });
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    parseEventElement(element, sourceUrl) {
        const event = {
            source: this.config.source,
            url: sourceUrl,
            timestamp: new Date().toISOString()
        };

        // Add detailed logging for debugging
        const isWebBrowser = typeof window !== 'undefined' && typeof DOMParser !== 'undefined';
        const elementPreview = !isWebBrowser ? element.innerHTML?.substring(0, 300) : element.outerHTML?.substring(0, 300);
        console.log(`🐻 Eventbrite: Parsing element with content:`, elementPreview);

        // Extract title - Eventbrite specific selectors
        const titleElement = element.querySelector('h3, .Typography_body-lg__487rx, .event-card__clamp-line--two, [aria-label*="View"], [class*="title"]');
        console.log(`🐻 Eventbrite: Title element found:`, titleElement ? (titleElement.textContent || titleElement.getAttribute?.('aria-label')) : 'null');
        
        if (titleElement) {
            event.title = titleElement.textContent.trim();
        } else {
            // Try to get title from aria-label if available
            const linkElement = element.querySelector('a[aria-label]');
            console.log(`🐻 Eventbrite: Fallback link element:`, linkElement ? linkElement.getAttribute('aria-label') : 'null');
            if (linkElement) {
                const ariaLabel = linkElement.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.startsWith('View ')) {
                    event.title = ariaLabel.replace('View ', '').trim();
                }
            }
        }

        // If still no title, try to extract from any text content
        if (!event.title) {
            const textContent = element.textContent || '';
            console.log(`🐻 Eventbrite: Raw text content:`, textContent.substring(0, 100));
            // Look for meaningful text that could be a title
            const lines = textContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            if (lines.length > 0) {
                // Take the first non-empty line as a potential title
                event.title = lines[0];
            }
        }

        console.log(`🐻 Eventbrite: Extracted title:`, event.title);

        // Extract date/time - Eventbrite specific
        const dateElement = element.querySelector('.Typography_body-md__487rx, [class*="date"], time, p');
        if (dateElement) {
            const dateText = dateElement.textContent.trim();
            // Look for date patterns like "Sat, Aug 23 • 9:00 PM"
            if (dateText.match(/\w+,\s+\w+\s+\d+|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/)) {
                event.dateString = dateText;
                event.date = this.parseDate(dateText);
            }
        }

        // Extract venue/location - Eventbrite specific
        const venueElements = element.querySelectorAll('.Typography_body-md__487rx');
        if (venueElements.length > 1) {
            // Usually the second Typography_body-md element is the venue
            event.venue = venueElements[1].textContent.trim();
        }

        // Extract price
        const priceElement = element.querySelector('.Typography_body-md-bold__487rx, [class*="price"]');
        if (priceElement) {
            event.price = priceElement.textContent.trim();
        }

        // Extract event URL - This is crucial for Eventbrite
        // For Scriptable environment, directly extract from HTML
        let linkElement = null;
        let href = null;
        
        if (!isWebBrowser) {
            // Use regex to find href in the element HTML
            const hrefMatch = element.innerHTML?.match(/href="([^"]*\/e\/[^"]*)"/i);
            if (hrefMatch) {
                href = hrefMatch[1];
                console.log(`🐻 Eventbrite: Found event link via regex:`, href);
            } else {
                console.log(`🐻 Eventbrite: No /e/ link found in element HTML`);
            }
        } else {
            // Web browser environment
            linkElement = element.querySelector('a[href*="/e/"]') || 
                         element.querySelector('a[href*="eventbrite.com/e/"]') || 
                         element.querySelector('a[data-event-id]') ||
                         element.closest('a[href*="/e/"]');
            
            if (linkElement) {
                href = linkElement.getAttribute('href');
                console.log(`🐻 Eventbrite: Found event link via querySelector:`, href);
            } else {
                console.log(`🐻 Eventbrite: No event link found via querySelector`);
            }
        }
        
        if (href) {
            // Clean up the URL - remove query parameters that aren't needed
            if (href.includes('?')) {
                href = href.split('?')[0];
            }
            
            if (href.startsWith('http')) {
                event.eventUrl = href;
            } else if (href.startsWith('/')) {
                event.eventUrl = `https://www.eventbrite.com${href}`;
            } else {
                event.eventUrl = `https://www.eventbrite.com/${href}`;
            }
            console.log(`🐻 Eventbrite: Final event URL:`, event.eventUrl);
        }

        // Extract city from venue, URL, or other indicators
        event.city = this.extractCity(event.venue + ' ' + (event.description || '') + ' ' + sourceUrl);

        // Extract description from various possible elements
        const descElement = element.querySelector('.event-description, .summary, p:not([class*="Typography"])');
        event.description = descElement ? descElement.textContent.trim() : '';

        return event;
    }

    parseDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Clean up the date string
            let cleanDateString = dateString.replace(/[^\w\s:,-]/g, ' ').trim();
            
            // Handle Eventbrite date formats like "Sat, Aug 23 • 9:00 PM"
            if (cleanDateString.includes('•')) {
                cleanDateString = cleanDateString.replace('•', '').trim();
            }
            
            // Try to parse various date formats
            const patterns = [
                /(\w{3}),?\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}:\d{2}\s*(AM|PM)?)/i, // "Sat, Aug 23 9:00 PM"
                /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, // "January 15, 2024"
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,   // "01/15/2024"
                /(\d{4})-(\d{1,2})-(\d{1,2})/,    // "2024-01-15"
            ];
            
            // For Eventbrite dates without year, assume current or next year
            if (cleanDateString.match(/\w{3},?\s+\w{3}\s+\d{1,2}/i) && !cleanDateString.match(/\d{4}/)) {
                const currentYear = new Date().getFullYear();
                cleanDateString += ` ${currentYear}`;
            }
            
            const parsed = new Date(cleanDateString);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
            
            // If that fails, try with a more aggressive cleanup
            const fallbackString = dateString.replace(/[^\w\s:]/g, ' ').replace(/\s+/g, ' ').trim();
            const fallbackParsed = new Date(fallbackString);
            return !isNaN(fallbackParsed.getTime()) ? fallbackParsed.toISOString() : null;
            
        } catch (error) {
            console.warn(`🐻 Eventbrite: Failed to parse date "${dateString}":`, error);
            return null;
        }
    }

    extractCity(text) {
        const cityPatterns = {
            'nyc': /new york|nyc|manhattan|brooklyn|queens|bronx/i,
            'sf': /san francisco|sf|bay area/i,
            'la': /los angeles|la|hollywood|west hollywood/i,
            'chicago': /chicago/i,
            'seattle': /seattle/i,
            'dc': /washington|dc|district of columbia/i,
            'boston': /boston/i,
            'atlanta': /atlanta/i,
            'miami': /miami|south beach/i,
            'dallas': /dallas/i,
            'denver': /denver/i,
            'portland': /portland/i,
            'philadelphia': /philadelphia|philly/i,
            'phoenix': /phoenix/i,
            'austin': /austin/i,
            'vegas': /las vegas|vegas/i
        };

        for (const [city, pattern] of Object.entries(cityPatterns)) {
            if (pattern.test(text)) {
                return city;
            }
        }
        
        return 'unknown';
    }

    extractEventId(url) {
        // Extract event ID from Eventbrite URLs like:
        // https://www.eventbrite.com/e/event-name-123456789
        // https://www.eventbrite.com/e/123456789
        const match = url.match(/\/e\/(?:[^-]+-)*(\d+)(?:-\d+)?$/);
        return match ? match[1] : null;
    }

    // Scriptable-compatible HTML parsing using regex
    parseHTMLForScriptable(html) {
        console.log('🐻 Eventbrite: Parsing HTML with regex for Scriptable environment');
        
        // Create a simple DOM-like object for Scriptable
        const scriptableDoc = {
            querySelectorAll: (selector) => {
                const elements = [];
                
                // Enhanced debugging - check what's actually in the HTML
                console.log(`🐻 Eventbrite: Checking selector "${selector}" in HTML of length ${html.length}`);
                
                // Simple regex-based element extraction for common Eventbrite patterns
                if (selector.includes('event-card') || selector.includes('Container_root') || selector.includes('event') || 
                    selector.includes('data-testid') || selector.includes('href*="/e/"') || selector.includes('href*="/events/"')) {
                    
                    // Enhanced patterns for modern Eventbrite (2025)
                    const eventPatterns = [
                        // Look for links to individual events (most reliable for Eventbrite)
                        /<a[^>]*href="[^"]*\/e\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
                        /<a[^>]*href="[^"]*\/events\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
                        // Modern Eventbrite event URLs
                        /<a[^>]*href="[^"]*eventbrite\.com\/e\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
                        /<a[^>]*href="[^"]*eventbrite\.com\/events\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
                        // Look for div elements containing event links
                        /<div[^>]*>[\s\S]*?<a[^>]*href="[^"]*\/e\/[^"]*"[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/div>/gi,
                        /<div[^>]*>[\s\S]*?<a[^>]*href="[^"]*\/events\/[^"]*"[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/div>/gi,
                        // Look for article tags which Eventbrite sometimes uses for events
                        /<article[^>]*>[\s\S]*?<a[^>]*href="[^"]*\/e\/[^"]*"[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/article>/gi,
                        // Look for event cards with specific classes
                        /<div[^>]*class="[^"]*event-card[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
                        /<div[^>]*class="[^"]*Container_root__[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
                        /<div[^>]*data-testid="event-card-tracking-layer"[^>]*>[\s\S]*?<\/div>/gi,
                        // New patterns for 2025 Eventbrite structure
                        /<div[^>]*data-testid="[^"]*event[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
                        /<section[^>]*>[\s\S]*?<a[^>]*href="[^"]*\/e\/[^"]*"[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/section>/gi
                    ];
                    
                    // Enhanced debugging - check for various link patterns
                    const linkPatterns = [
                        { name: 'e/ links', pattern: /href="[^"]*\/e\/[^"]*"/gi },
                        { name: 'events/ links', pattern: /href="[^"]*\/events\/[^"]*"/gi },
                        { name: 'eventbrite.com links', pattern: /href="[^"]*eventbrite\.com[^"]*"/gi },
                        { name: 'any href links', pattern: /href="[^"]*"/gi }
                    ];
                    
                    linkPatterns.forEach(({ name, pattern }) => {
                        const matches = html.match(pattern) || [];
                        console.log(`🐻 Eventbrite: Found ${matches.length} ${name}`);
                        if (matches.length > 0 && matches.length <= 3) {
                            matches.forEach((match, i) => {
                                console.log(`🐻 Eventbrite: ${name} ${i + 1}: ${match}`);
                            });
                        }
                    });
                    
                    // First, try to find elements that contain event links (expanded patterns)
                    const eventLinkPatterns = [
                        /href="[^"]*\/e\/[^"]*"/gi,
                        /href="[^"]*\/events\/[^"]*"/gi,
                        /href="[^"]*eventbrite\.com\/e\/[^"]*"/gi,
                        /href="[^"]*eventbrite\.com\/events\/[^"]*"/gi
                    ];
                    
                    let hasEventLinks = false;
                    eventLinkPatterns.forEach(pattern => {
                        const matches = html.match(pattern);
                        if (matches && matches.length > 0) {
                            hasEventLinks = true;
                            console.log(`🐻 Eventbrite: Found ${matches.length} event links with pattern ${pattern}`);
                        }
                    });
                    
                    if (hasEventLinks) {
                        // Extract the surrounding HTML for each event link (enhanced patterns)
                        const allEventLinkPatterns = [
                            /<[^>]*href="[^"]*\/e\/[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi,
                            /<[^>]*href="[^"]*\/events\/[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi,
                            /<[^>]*href="[^"]*eventbrite\.com\/e\/[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi,
                            /<[^>]*href="[^"]*eventbrite\.com\/events\/[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi
                        ];
                        
                        allEventLinkPatterns.forEach(pattern => {
                            const eventLinkMatches = [...html.matchAll(pattern)];
                            eventLinkMatches.forEach(match => {
                                // Try to get the parent container that includes more event details
                                const linkHtml = match[0];
                                const linkStart = match.index;
                                
                                // Look backwards and forwards for a containing div/article
                                let containerStart = linkStart;
                                let containerEnd = match.index + linkHtml.length;
                                
                                // Find the opening tag of a container (div, article, etc.)
                                const beforeHtml = html.substring(Math.max(0, linkStart - 1000), linkStart);
                                const containerMatch = beforeHtml.match(/<(div|article|section)[^>]*>(?!.*<\/\1>)/gi);
                                if (containerMatch) {
                                    const lastContainer = containerMatch[containerMatch.length - 1];
                                    containerStart = linkStart - (beforeHtml.length - beforeHtml.lastIndexOf(lastContainer));
                                }
                                
                                // Find the closing tag
                                const afterHtml = html.substring(containerEnd, Math.min(html.length, containerEnd + 1000));
                                const closingMatch = afterHtml.match(/<\/(div|article|section)>/i);
                                if (closingMatch) {
                                    containerEnd = containerEnd + afterHtml.indexOf(closingMatch[0]) + closingMatch[0].length;
                                }
                                
                                const containerHtml = html.substring(containerStart, containerEnd);
                                elements.push(this.createScriptableElement(containerHtml));
                            });
                        });
                    } else {
                        console.log('🐻 Eventbrite: No event links found, trying fallback patterns');
                        // Fallback to original patterns if no event links found
                        eventPatterns.forEach(pattern => {
                            const matches = html.match(pattern) || [];
                            matches.forEach(match => {
                                elements.push(this.createScriptableElement(match));
                            });
                        });
                        
                        // If still no elements, try to extract any divs that might contain events
                        if (elements.length === 0) {
                            console.log('🐻 Eventbrite: No elements found with event patterns, trying generic div extraction');
                            const genericDivPattern = /<div[^>]*class="[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
                            const divMatches = html.match(genericDivPattern) || [];
                            console.log(`🐻 Eventbrite: Found ${divMatches.length} generic divs`);
                            
                            // Take first few divs that might contain events
                            divMatches.slice(0, 10).forEach(match => {
                                if (match.toLowerCase().includes('event') || 
                                    match.toLowerCase().includes('date') || 
                                    match.toLowerCase().includes('time') ||
                                    match.includes('href=')) {
                                    elements.push(this.createScriptableElement(match));
                                }
                            });
                        }
                    }
                }
                
                console.log(`🐻 Eventbrite: Found ${elements.length} elements with selector "${selector}"`);
                return elements;
            }
        };
        
        return scriptableDoc;
    }

    // Create a simple element object for Scriptable
    createScriptableElement(htmlString) {
        const element = {
            innerHTML: htmlString,
            textContent: this.extractTextContent(htmlString),
            querySelector: (selector) => {
                return this.findElementInHTML(htmlString, selector);
            },
            querySelectorAll: (selector) => {
                return this.findAllElementsInHTML(htmlString, selector);
            },
            closest: (selector) => {
                // For Scriptable, just return the current element if it matches, or null
                if (selector.includes('a') && htmlString.includes('<a')) {
                    return this.findElementInHTML(htmlString, 'a');
                }
                return null;
            },
            getAttribute: (attr) => {
                const attrMatch = htmlString.match(new RegExp(`${attr}="([^"]*)"`, 'i'));
                return attrMatch ? attrMatch[1] : null;
            }
        };
        return element;
    }

    // Find a single element in HTML string
    findElementInHTML(htmlString, selector) {
        // Handle heading selectors (h1, h2, h3, etc.)
        if (selector.includes('h1') || selector.includes('h2') || selector.includes('h3')) {
            const headingMatch = htmlString.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
            if (headingMatch) {
                return {
                    textContent: this.stripHtmlTags(headingMatch[1]),
                    innerHTML: headingMatch[1],
                    getAttribute: () => null
                };
            }
        }
        
        // Handle time elements
        if (selector.includes('time')) {
            const timeMatch = htmlString.match(/<time[^>]*datetime="([^"]*)"[^>]*>(.*?)<\/time>/i);
            if (timeMatch) {
                return {
                    getAttribute: (attr) => attr === 'datetime' ? timeMatch[1] : null,
                    textContent: this.stripHtmlTags(timeMatch[2])
                };
            }
        }
        
        // Handle link elements
        if (selector.includes('a')) {
            // Look for links with specific attributes
            if (selector.includes('aria-label')) {
                const linkMatch = htmlString.match(/<a[^>]*aria-label="([^"]*)"[^>]*>(.*?)<\/a>/i);
                if (linkMatch) {
                    return {
                        getAttribute: (attr) => {
                            if (attr === 'aria-label') return linkMatch[1];
                            const hrefMatch = linkMatch[0].match(/href="([^"]*)"/i);
                            if (attr === 'href') return hrefMatch ? hrefMatch[1] : null;
                            return null;
                        },
                        textContent: this.stripHtmlTags(linkMatch[2])
                    };
                }
            }
            
            // Look for links with /e/ in href (event links)
            if (selector.includes('/e/')) {
                const eventLinkMatch = htmlString.match(/<a[^>]*href="([^"]*\/e\/[^"]*)"[^>]*>(.*?)<\/a>/i);
                if (eventLinkMatch) {
                    return {
                        getAttribute: (attr) => attr === 'href' ? eventLinkMatch[1] : null,
                        textContent: this.stripHtmlTags(eventLinkMatch[2])
                    };
                }
            }
            
            // General link match
            const linkMatch = htmlString.match(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/i);
            if (linkMatch) {
                return {
                    getAttribute: (attr) => attr === 'href' ? linkMatch[1] : null,
                    textContent: this.stripHtmlTags(linkMatch[2])
                };
            }
        }

        // Handle paragraph elements
        if (selector.includes('p')) {
            const pMatch = htmlString.match(/<p[^>]*>(.*?)<\/p>/i);
            if (pMatch) {
                return {
                    textContent: this.stripHtmlTags(pMatch[1]),
                    innerHTML: pMatch[1],
                    getAttribute: () => null
                };
            }
        }

        // Handle class-based selectors
        if (selector.includes('.') || selector.includes('[class')) {
            // Extract class name from selector
            const classMatch = selector.match(/\.([a-zA-Z0-9_-]+)/) || selector.match(/class[*=]*["']([^"']+)["']/);
            if (classMatch) {
                const className = classMatch[1];
                const elementMatch = htmlString.match(new RegExp(`<[^>]*class="[^"]*${className}[^"]*"[^>]*>(.*?)<\/[^>]+>`, 'i'));
                if (elementMatch) {
                    return {
                        textContent: this.stripHtmlTags(elementMatch[1]),
                        innerHTML: elementMatch[1],
                        getAttribute: () => null
                    };
                }
            }
        }
        
        return null;
    }

    // Find all elements in HTML string
    findAllElementsInHTML(htmlString, selector) {
        const elements = [];
        
        if (selector.includes('img')) {
            const imgMatches = htmlString.match(/<img[^>]*>/gi) || [];
            imgMatches.forEach(match => {
                const srcMatch = match.match(/src="([^"]*)"/i);
                const altMatch = match.match(/alt="([^"]*)"/i);
                elements.push({
                    getAttribute: (attr) => {
                        if (attr === 'src') return srcMatch ? srcMatch[1] : null;
                        if (attr === 'alt') return altMatch ? altMatch[1] : null;
                        return null;
                    },
                    textContent: '',
                    innerHTML: match
                });
            });
        }
        
        // Handle class-based selectors for multiple elements
        if (selector.includes('.Typography_body-md__487rx')) {
            const matches = htmlString.match(/<[^>]*class="[^"]*Typography_body-md__487rx[^"]*"[^>]*>(.*?)<\/[^>]+>/gi) || [];
            matches.forEach(match => {
                elements.push({
                    textContent: this.stripHtmlTags(match),
                    innerHTML: match,
                    getAttribute: () => null
                });
            });
        }
        
        return elements;
    }

    // Extract text content from HTML string
    extractTextContent(html) {
        return this.stripHtmlTags(html).trim();
    }

    // Strip HTML tags from string
    stripHtmlTags(html) {
        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    isBearEvent(event) {
        const searchText = `${event.title} ${event.description || ''} ${event.venue || ''}`.toLowerCase();
        return this.bearKeywords.some(keyword => searchText.includes(keyword.toLowerCase()));
    }

    extractAdditionalLinks(doc, baseUrl) {
        const links = [];
        const isWebBrowser = typeof window !== 'undefined' && typeof DOMParser !== 'undefined';
        
        if (!isWebBrowser) {
            // Scriptable environment - use regex to find links
            console.log('🐻 Eventbrite: Extracting additional links using regex for Scriptable');
            
            // More comprehensive patterns for Eventbrite event links
            const linkPatterns = [
                // Direct eventbrite.com/e/ links
                /href="([^"]*eventbrite\.com\/e\/[^"]*?)"/gi,
                // Relative /e/ links
                /href="(\/e\/[^"]*?)"/gi,
                // Links with event IDs
                /href="([^"]*\/events\/[^"]*?)"/gi
            ];
            
            const htmlContent = typeof doc === 'string' ? doc : (doc.innerHTML || '');
            
            linkPatterns.forEach(pattern => {
                let match;
                while ((match = pattern.exec(htmlContent)) !== null) {
                    const href = match[1];
                    if (href) {
                        try {
                            let fullUrl;
                            if (href.startsWith('http')) {
                                fullUrl = href;
                            } else if (href.startsWith('/')) {
                                fullUrl = `https://www.eventbrite.com${href}`;
                            } else {
                                fullUrl = `${baseUrl}/${href}`;
                            }
                            
                            // Clean up URL - remove query parameters except event ID
                            if (fullUrl.includes('?')) {
                                const [baseEventUrl] = fullUrl.split('?');
                                fullUrl = baseEventUrl;
                            }
                            
                            // Only add if it's actually an event URL and not already included
                            if ((fullUrl.includes('/e/') || fullUrl.includes('/events/')) && !links.includes(fullUrl)) {
                                links.push(fullUrl);
                                console.log(`🐻 Eventbrite: Found event link: ${fullUrl}`);
                            }
                        } catch (error) {
                            console.warn(`🐻 Eventbrite: Invalid link found: ${href}`);
                        }
                    }
                }
            });
        } else {
            // Web environment - use querySelectorAll
            const linkElements = doc.querySelectorAll('a[href*="eventbrite.com/e/"], a[href*="/e/"], a[href*="/events/"]');
            
            linkElements.forEach(link => {
                const href = link.getAttribute('href');
                if (href) {
                    try {
                        let fullUrl;
                        if (href.startsWith('http')) {
                            fullUrl = href;
                        } else if (href.startsWith('/')) {
                            fullUrl = `https://www.eventbrite.com${href}`;
                        } else {
                            fullUrl = new URL(href, baseUrl).href;
                        }
                        
                        // Clean up URL - remove query parameters except event ID
                        if (fullUrl.includes('?')) {
                            const [baseEventUrl] = fullUrl.split('?');
                            fullUrl = baseEventUrl;
                        }
                        
                        // Only add if it's actually an event URL and not already included
                        if ((fullUrl.includes('/e/') || fullUrl.includes('/events/')) && !links.includes(fullUrl)) {
                            links.push(fullUrl);
                            console.log(`🐻 Eventbrite: Found event link: ${fullUrl}`);
                        }
                    } catch (error) {
                        console.warn(`🐻 Eventbrite: Invalid link found: ${href}`);
                    }
                }
            });
        }
        
        console.log(`🐻 Eventbrite: Extracted ${links.length} additional event links`);
        return links.slice(0, 20); // Limit to 20 additional links per page
    }

    // Extract events from embedded JSON data (modern Eventbrite approach)
    extractEventsFromJson(html) {
        const events = [];
        
        // Look for window.__SERVER_DATA__ which contains the event information
        const serverDataMatch = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});/);
        
        if (serverDataMatch && serverDataMatch[1]) {
            try {
                const serverData = JSON.parse(serverDataMatch[1]);
                console.log('🐻 Eventbrite: Found window.__SERVER_DATA__');
                
                // Check for events in view_data.events.future_events
                if (serverData.view_data && serverData.view_data.events && serverData.view_data.events.future_events) {
                    const futureEvents = serverData.view_data.events.future_events;
                    console.log(`🐻 Eventbrite: Found ${futureEvents.length} future events in JSON data`);
                    
                    futureEvents.forEach(eventData => {
                        if (eventData.url && eventData.name && eventData.name.text) {
                            const event = {
                                id: eventData.id || this.extractEventId(eventData.url),
                                title: eventData.name.text,
                                url: eventData.url,
                                date: eventData.start ? eventData.start.utc : null,
                                location: eventData.venue ? eventData.venue.name : null,
                                address: eventData.venue && eventData.venue.address ? 
                                    eventData.venue.address.localized_address_display : null,
                                description: eventData.summary || '',
                                source: this.config.source,
                                timestamp: new Date().toISOString(),
                                isPlaceholder: false,
                                isBearEvent: this.config.alwaysBear || this.isBearEvent({
                                    name: eventData.name.text,
                                    description: eventData.summary || '',
                                    url: eventData.url
                                }),
                                requiresDetailFetch: this.config.requireDetailPages // JSON already has most details, but user may want more
                            };
                            
                            console.log(`🐻 Eventbrite: Parsed event: ${event.title} (${event.date})`);
                            events.push(event);
                        }
                    });
                }
                
                // Also check for past events if needed for debugging
                if (serverData.view_data && serverData.view_data.events && serverData.view_data.events.past_events) {
                    const pastEvents = serverData.view_data.events.past_events;
                    console.log(`🐻 Eventbrite: Found ${pastEvents.length} past events in JSON data (not included)`);
                }
                
            } catch (error) {
                console.warn('🐻 Eventbrite: Failed to parse window.__SERVER_DATA__:', error);
            }
        }
        
        // Fallback: Look for JSON-LD structured data
        if (events.length === 0) {
            const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
            
            if (jsonLdMatch) {
                jsonLdMatch.forEach(script => {
                    const jsonContent = script.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
                    try {
                        const jsonData = JSON.parse(jsonContent);
                        
                        // Handle array of events
                        if (Array.isArray(jsonData)) {
                            jsonData.forEach(item => {
                                if (item['@type'] === 'Event' && item.name && item.startDate && item.url) {
                                    const event = {
                                        id: this.extractEventId(item.url),
                                        title: item.name,
                                        url: item.url,
                                        date: item.startDate,
                                        location: item.location ? item.location.name : null,
                                        description: item.description || '',
                                        source: this.config.source,
                                        timestamp: new Date().toISOString(),
                                        isPlaceholder: false,
                                        isBearEvent: this.isBearEvent(item),
                                        requiresDetailFetch: this.config.requireDetailPages
                                    };
                                    events.push(event);
                                }
                            });
                        }
                        // Handle single event or ItemList
                        else if (jsonData['@type'] === 'Event' && jsonData.name && jsonData.startDate && jsonData.url) {
                            const event = {
                                id: this.extractEventId(jsonData.url),
                                title: jsonData.name,
                                url: jsonData.url,
                                date: jsonData.startDate,
                                location: jsonData.location ? jsonData.location.name : null,
                                description: jsonData.description || '',
                                source: this.config.source,
                                timestamp: new Date().toISOString(),
                                isPlaceholder: false,
                                isBearEvent: this.isBearEvent(jsonData),
                                requiresDetailFetch: this.config.requireDetailPages
                            };
                            events.push(event);
                        }
                        // Handle ItemList structure
                        else if (jsonData['@type'] === 'ItemList' && jsonData.itemListElement) {
                            jsonData.itemListElement.forEach(listItem => {
                                const item = listItem.item;
                                if (item && item['@type'] === 'Event' && item.name && item.startDate && item.url) {
                                    const event = {
                                        id: this.extractEventId(item.url),
                                        title: item.name,
                                        url: item.url,
                                        date: item.startDate,
                                        location: item.location ? item.location.name : null,
                                        description: item.description || '',
                                        source: this.config.source,
                                        timestamp: new Date().toISOString(),
                                        isPlaceholder: false,
                                        isBearEvent: this.isBearEvent(item),
                                        requiresDetailFetch: this.config.requireDetailPages
                                    };
                                    events.push(event);
                                }
                            });
                        }
                    } catch (error) {
                        console.warn('🐻 Eventbrite: Failed to parse JSON-LD data:', error);
                    }
                });
            }
        }
        
        console.log(`🐻 Eventbrite: Extracted ${events.length} events from JSON data`);
        return events;
    }
}

    // Export for both environments
    if (typeof window !== 'undefined') {
        window.EventbriteEventParser = EventbriteEventParser;
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = { EventbriteEventParser };
    } else {
        // Scriptable environment
        this.EventbriteEventParser = EventbriteEventParser;
    }

} // End of conditional class declaration
// Bear Event Scraper V3 for Scriptable
// Enhanced with precise parsing patterns based on actual website analysis
// Implements specific HTML structure parsing for each source

// ===== EMBEDDED MINIFIED MODULES =====

// JSON File Manager (from existing implementation)
class JSONFileManager{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory()}write(e,r){const t=this.documentsDirectory+"/"+e,i=FileManager.local();i.writeString(t,JSON.stringify(r))}read(e){const r=this.documentsDirectory+"/"+e,t=FileManager.local();return JSON.parse(t.readString(r))}}

// File Logger (from existing implementation)
class FileLogger{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory(),this.logs=[]}getDateString(){return(new Date).toISOString()}log(e){this.logs.push(this.getDateString()+" - "+e)}writeLogs(e){const t=this.documentsDirectory+"/"+e,s=FileManager.local();s.writeString(t,this.logs.join("\n"))}}

// Performance Debugger (from existing implementation)
class PerformanceDebugger{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory(),this.performanceData=[]}getDateString(){return(new Date).toISOString()}async wrap(e,t){const n=e.name||"anonymous",r=this.getDateString(),a=await e(...t),i=this.getDateString(),o=new Date(i)-new Date(r);return this.performanceData.push({functionName:n,startTime:r,endTime:i,duration:o}),a}appendPerformanceDataToFile(e){const t=this.documentsDirectory+"/"+e,n=FileManager.local();let r="functionName,startTime,endTime,duration\n";n.fileExists(t)&&(r=""),this.performanceData.forEach(e=>{r+=`${e.functionName},${e.startTime},${e.endTime},${e.duration}\n`}),n.isFileDownloaded(t)?n.downloadFileFromiCloud(t).then(()=>{const e=n.readString(t);n.writeString(t,e+r)}):n.fileExists(t)?n.writeString(t,n.readString(t)+r):n.writeString(t,r)}}

// ===== ENHANCED SCRAPER CLASS V3 =====

class BearEventScraperV3 {
    constructor() {
        this.jsonManager = new JSONFileManager();
        this.logger = new FileLogger();
        this.perfDebugger = new PerformanceDebugger();
        
        // Configuration files
        this.CONFIG_FILE = "bear-event-scraper-v3-config.json";
        this.INPUT_FILE = "bear-event-parser-input.json";
        this.LOG_FILE = "bear-event-scraper-v3-logs.txt";
        this.PERFORMANCE_FILE = "bear-event-scraper-v3-performance.csv";
        
        // Enhanced bear keywords
        this.bearKeywords = [
            'bear', 'bears', 'cub', 'cubs', 'otter', 'otters', 'daddy', 'daddies',
            'woof', 'grr', 'furry', 'hairy', 'beef', 'chunk', 'chub', 'muscle bear',
            'leather bear', 'polar bear', 'grizzly', 'bearracuda', 'furball', 'megawoof',
            'rockstrap', 'underbear', 'bearnight', 'bearpride', 'bearweek', 'tbru', 
            'bearcrazy', 'bearparty', 'bear happy hour', 'bear tea', 'bear brunch',
            'diaper happy hour', 'bears night out' // Added from Rockbar analysis
        ];
        
        // City calendar mapping
        this.cityCalendarMap = {
            'nyc': 'chunky-dad-nyc',
            'new york': 'chunky-dad-nyc',
            'manhattan': 'chunky-dad-nyc',
            'brooklyn': 'chunky-dad-nyc',
            'la': 'chunky-dad-la',
            'los angeles': 'chunky-dad-la',
            'west hollywood': 'chunky-dad-la',
            'sf': 'chunky-dad-sf',
            'san francisco': 'chunky-dad-sf',
            'chicago': 'chunky-dad-chicago',
            'seattle': 'chunky-dad-seattle',
            'portland': 'chunky-dad-portland',
            'denver': 'chunky-dad-denver',
            'austin': 'chunky-dad-austin',
            'miami': 'chunky-dad-miami',
            'fort lauderdale': 'chunky-dad-miami',
            'wilton manors': 'chunky-dad-miami',
            'boston': 'chunky-dad-boston',
            'dc': 'chunky-dad-dc',
            'washington': 'chunky-dad-dc',
            'atlanta': 'chunky-dad-atlanta',
            'dallas': 'chunky-dad-dallas',
            'philadelphia': 'chunky-dad-philadelphia',
            'phoenix': 'chunky-dad-phoenix'
        };
        
        // Default venue addresses
        this.defaultVenues = {
            'rockbar': '185 Christopher Street, NYC',
            'eagle nyc': '554 W 28th St, New York, NY 10001'
        };
        
        this.logger.log("Bear Event Scraper V3 initialized with precise parsing patterns");
    }
    
    // Load configuration from input file
    async loadInput() {
        try {
            const input = this.jsonManager.read(this.INPUT_FILE);
            this.logger.log("Input configuration loaded successfully");
            return input;
        } catch (error) {
            this.logger.log(`No input file found, using default configuration: ${error.message}`);
            return {
                parsers: [
                    {
                        name: "Furball",
                        parser: "furball",
                        urls: [
                            "https://www.furball.nyc/upcoming-schedule",
                            "https://www.furball.nyc/ticket-information"
                        ]
                    },
                    {
                        name: "Rockbar",
                        parser: "rockbar",
                        urls: [
                            "https://www.rockbarnyc.com/events",
                            "https://www.rockbarnyc.com/calendar"
                        ],
                        allowlist: ["rockstrap", "underbear", "diaper happy hour"]
                    },
                    {
                        name: "Bearracuda",
                        parser: "bearracuda",
                        urls: ["https://bearracuda.com/#events"]
                    },
                    {
                        name: "Megawoof",
                        parser: "megawoof",
                        urls: ["https://www.eventbrite.com/o/megawoof-america-18118978189"]
                    }
                ],
                config: {
                    notCheckedFlag: true,
                    debugMode: true
                }
            };
        }
    }
    
    // Parse date with enhanced formats
    parseDate(dateStr, referenceDate = new Date()) {
        if (!dateStr) return null;
        
        // Clean the date string
        dateStr = dateStr.trim().replace(/\s+/g, ' ');
        
        // Try standard date parsing first
        try {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return date;
            }
        } catch (e) {}
        
        // Month mapping
        const months = {
            'january': 0, 'jan': 0, 'february': 1, 'feb': 1, 'march': 2, 'mar': 2,
            'april': 3, 'apr': 3, 'may': 4, 'june': 5, 'jun': 5, 'july': 6, 'jul': 6,
            'august': 7, 'aug': 7, 'september': 8, 'sep': 8, 'sept': 8,
            'october': 9, 'oct': 9, 'november': 10, 'nov': 10, 'december': 11, 'dec': 11
        };
        
        // Enhanced patterns for Furball format (e.g., "JULY 25, 2025")
        const patterns = [
            /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i,  // MONTH DD, YYYY
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/,   // MM/DD/YYYY
            /(\d{4})-(\d{2})-(\d{2})/,         // YYYY-MM-DD
            /(\d{1,2})\s+(\w+)\s+(\d{4})/,     // DD MONTH YYYY
            /(\w+)\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s+(\d{4})/i, // MONTH DD-DD, YYYY (range)
        ];
        
        for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
                try {
                    let year, month, day;
                    
                    if (pattern.source.includes('\\w+')) {
                        // Month name format
                        const monthName = match[1].toLowerCase();
                        month = months[monthName];
                        day = parseInt(match[2]);
                        year = parseInt(match[3] || match[4]); // Handle range format
                        
                        if (month !== undefined && !isNaN(day) && !isNaN(year)) {
                            return new Date(year, month, day);
                        }
                    } else if (match[1].length === 4) {
                        // YYYY-MM-DD format
                        year = parseInt(match[1]);
                        month = parseInt(match[2]) - 1;
                        day = parseInt(match[3]);
                        return new Date(year, month, day);
                    } else {
                        // MM/DD/YYYY format
                        month = parseInt(match[1]) - 1;
                        day = parseInt(match[2]);
                        year = parseInt(match[3]);
                        return new Date(year, month, day);
                    }
                } catch (e) {
                    this.logger.log(`Error parsing date: ${e.message}`);
                }
            }
        }
        
        return null;
    }
    
    // Extract city from location text
    extractCityFromLocation(locationText) {
        if (!locationText) return null;
        
        const lowerLocation = locationText.toLowerCase();
        
        // Look for explicit city patterns like "Chicago - Metro, Chicago, IL"
        const cityStatePattern = /,\s*([^,]+),\s*([A-Z]{2})/i;
        const match = locationText.match(cityStatePattern);
        if (match) {
            const city = match[1].trim().toLowerCase();
            for (const [cityKey, calendarName] of Object.entries(this.cityCalendarMap)) {
                if (city.includes(cityKey) || cityKey.includes(city)) {
                    return calendarName;
                }
            }
        }
        
        // Check against all city mappings
        for (const [cityKey, calendarName] of Object.entries(this.cityCalendarMap)) {
            if (lowerLocation.includes(cityKey)) {
                return calendarName;
            }
        }
        
        // Check for "NYC" or "NY" specifically
        if (lowerLocation.includes('nyc') || lowerLocation.includes('new york') || 
            lowerLocation.includes('ny,') || lowerLocation.includes(', ny')) {
            return 'chunky-dad-nyc';
        }
        
        return null;
    }
    
    // Parse Furball with specific structure
    async parseFurball(urls, config) {
        const events = [];
        const eventData = new Map(); // Store events by date to merge info
        
        for (const url of urls) {
            try {
                this.logger.log(`Fetching Furball URL: ${url}`);
                const request = new Request(url);
                const html = await request.loadString();
                
                // Parse based on URL type
                if (url.includes('upcoming-schedule')) {
                    // Pattern: <h2>DATE</h2> followed by <h2>TITLE</h2> followed by <h3>LOCATION</h3>
                    const h2Pattern = /<h2[^>]*>([^<]+)<\/h2>/gi;
                    const h3Pattern = /<h3[^>]*>([^<]+)<\/h3>/gi;
                    
                    let h2Matches = [];
                    let h3Matches = [];
                    let match;
                    
                    // Collect all h2 tags
                    while ((match = h2Pattern.exec(html)) !== null) {
                        h2Matches.push({ text: match[1].trim(), index: match.index });
                    }
                    
                    // Collect all h3 tags
                    while ((match = h3Pattern.exec(html)) !== null) {
                        h3Matches.push({ text: match[1].trim(), index: match.index });
                    }
                    
                    // Process h2 tags in pairs (date, title) with following h3 (location)
                    for (let i = 0; i < h2Matches.length - 1; i++) {
                        const dateText = h2Matches[i].text;
                        const date = this.parseDate(dateText);
                        
                        if (date) {
                            const title = h2Matches[i + 1].text;
                            
                            // Find the next h3 after the title
                            const titleIndex = h2Matches[i + 1].index;
                            const locationMatch = h3Matches.find(h3 => h3.index > titleIndex);
                            const location = locationMatch ? locationMatch.text : '';
                            
                            const event = {
                                date: date,
                                title: title,
                                name: title,
                                venue: location,
                                location: location,
                                source: "Furball",
                                url: url,
                                confidence: "high"
                            };
                            
                            // Extract city from location
                            const city = this.extractCityFromLocation(location);
                            if (city) {
                                event.calendar = city;
                            }
                            
                            // Store in map for merging
                            const dateKey = date.toISOString().split('T')[0];
                            eventData.set(dateKey, event);
                            
                            i++; // Skip the title h2 since we processed it
                        }
                    }
                    
                } else if (url.includes('ticket-information')) {
                    // Similar pattern, merge additional info
                    const contentMatch = html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
                    if (contentMatch) {
                        // Extract pricing info
                        const priceMatch = contentMatch[1].match(/\$(\d+)/);
                        if (priceMatch) {
                            // Add price to all events
                            for (const [key, event] of eventData) {
                                event.price = `$${priceMatch[1]}`;
                                event.description = (event.description || '') + ` Cover: $${priceMatch[1]}`;
                            }
                        }
                    }
                }
                
                // Look for additional links to follow
                const linkPattern = /<a[^>]*href="([^"]*)"[^>]*>/gi;
                const links = [];
                let linkMatch;
                while ((linkMatch = linkPattern.exec(html)) !== null) {
                    const href = linkMatch[1];
                    if (href.includes('event') || href.includes('dj') || href.includes('info')) {
                        links.push(new URL(href, url).toString());
                    }
                }
                
                // Optionally fetch linked pages for more details
                for (const link of links.slice(0, 3)) { // Limit to 3 to avoid too many requests
                    try {
                        const linkRequest = new Request(link);
                        const linkHtml = await linkRequest.loadString();
                        // Extract any additional description
                        const descMatch = linkHtml.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
                        if (descMatch) {
                            for (const [key, event] of eventData) {
                                event.extendedDescription = descMatch[1];
                            }
                        }
                    } catch (linkError) {
                        this.logger.log(`Error fetching Furball link ${link}: ${linkError.message}`);
                    }
                }
                
            } catch (error) {
                this.logger.log(`Error parsing Furball URL ${url}: ${error.message}`);
            }
        }
        
        // Convert map to array
        events.push(...eventData.values());
        
        this.logger.log(`Found ${events.length} Furball events`);
        return events;
    }
    
    // Parse Rockbar with specific structure
    async parseRockbar(urls, config) {
        const events = [];
        const processedTitles = new Set(); // Avoid duplicates
        
        for (const url of urls) {
            try {
                this.logger.log(`Fetching Rockbar URL: ${url}`);
                const request = new Request(url);
                const html = await request.loadString();
                
                if (url.includes('/events')) {
                    // Primary parsing: <h3> for title, adjacent <div> for date/time/description
                    const eventPattern = /<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/gi;
                    let match;
                    
                    while ((match = eventPattern.exec(html)) !== null) {
                        const title = match[1].trim();
                        const details = match[2];
                        
                        // Check if it's a bear event
                        const titleLower = title.toLowerCase();
                        const detailsLower = details.toLowerCase();
                        const combinedText = titleLower + ' ' + detailsLower;
                        
                        const isBearEvent = this.bearKeywords.some(keyword => 
                            combinedText.includes(keyword)
                        ) || (config.allowlist && config.allowlist.some(keyword => 
                            combinedText.includes(keyword.toLowerCase())
                        ));
                        
                        if (isBearEvent && !processedTitles.has(title)) {
                            processedTitles.add(title);
                            
                            // Extract date and time from details
                            const dateMatch = details.match(/(\w+day),?\s+(\w+)\s+(\d{1,2})/i);
                            const timeMatch = details.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
                            
                            const event = {
                                title: title,
                                name: title,
                                venue: "Rockbar",
                                location: this.defaultVenues.rockbar,
                                calendar: "chunky-dad-nyc",
                                source: "Rockbar",
                                url: url,
                                confidence: "high"
                            };
                            
                            if (dateMatch) {
                                // Parse date like "Friday, January 10"
                                const monthName = dateMatch[2];
                                const day = dateMatch[3];
                                const year = new Date().getFullYear(); // Assume current year
                                const dateStr = `${monthName} ${day}, ${year}`;
                                event.date = this.parseDate(dateStr);
                            }
                            
                            if (timeMatch) {
                                event.time = timeMatch[0];
                            }
                            
                            // Extract description (remove date/time)
                            let description = details;
                            if (dateMatch) description = description.replace(dateMatch[0], '');
                            if (timeMatch) description = description.replace(timeMatch[0], '');
                            event.description = description.trim();
                            
                            // Look for "View Event →" link
                            const linkPattern = new RegExp(`<h3[^>]*>${title}<\/h3>[\\s\\S]*?<a[^>]*href="([^"]*)"[^>]*>View Event`, 'i');
                            const linkMatch = html.match(linkPattern);
                            
                            if (linkMatch) {
                                const detailUrl = new URL(linkMatch[1], url).toString();
                                event.detailUrl = detailUrl;
                                
                                // Fetch detail page for extended info
                                try {
                                    const detailRequest = new Request(detailUrl);
                                    const detailHtml = await detailRequest.loadString();
                                    
                                    // Extract extended description
                                    const extDescMatch = detailHtml.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
                                    if (extDescMatch) {
                                        event.extendedDescription = this.stripHtml(extDescMatch[1]);
                                    }
                                } catch (detailError) {
                                    this.logger.log(`Error fetching Rockbar detail page: ${detailError.message}`);
                                }
                            }
                            
                            events.push(event);
                        }
                    }
                    
                } else if (url.includes('/calendar')) {
                    // Fallback calendar parsing
                    const calendarPattern = /<div[^>]*class="[^"]*event[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
                    let match;
                    
                    while ((match = calendarPattern.exec(html)) !== null) {
                        const eventHtml = match[1];
                        const titleMatch = eventHtml.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
                        
                        if (titleMatch) {
                            const title = titleMatch[1].trim();
                            
                            if (!processedTitles.has(title)) {
                                const titleLower = title.toLowerCase();
                                const isBearEvent = this.bearKeywords.some(keyword => 
                                    titleLower.includes(keyword)
                                ) || (config.allowlist && config.allowlist.some(keyword => 
                                    titleLower.includes(keyword.toLowerCase())
                                ));
                                
                                if (isBearEvent) {
                                    processedTitles.add(title);
                                    
                                    const event = {
                                        title: title,
                                        name: title,
                                        venue: "Rockbar",
                                        location: this.defaultVenues.rockbar,
                                        calendar: "chunky-dad-nyc",
                                        source: "Rockbar",
                                        url: url,
                                        confidence: "medium"
                                    };
                                    
                                    events.push(event);
                                }
                            }
                        }
                    }
                }
                
            } catch (error) {
                this.logger.log(`Error parsing Rockbar URL ${url}: ${error.message}`);
            }
        }
        
        this.logger.log(`Found ${events.length} Rockbar events`);
        return events;
    }
    
    // Parse Bearracuda (keeping V2 implementation as it wasn't analyzed)
    async parseBearracuda(urls, config) {
        const events = [];
        
        for (const url of urls) {
            try {
                this.logger.log(`Fetching Bearracuda URL: ${url}`);
                const request = new Request(url);
                const html = await request.loadString();
                
                // Look for event links
                const eventLinks = html.match(/<a[^>]*href="([^"]*event[^"]*)"[^>]*>[\s\S]*?<\/a>/gi) || [];
                
                for (const link of eventLinks) {
                    const hrefMatch = link.match(/href="([^"]*)"/);
                    if (hrefMatch) {
                        try {
                            const detailUrl = new URL(hrefMatch[1], url).toString();
                            const detailRequest = new Request(detailUrl);
                            const detailHtml = await detailRequest.loadString();
                            
                            // Extract event details
                            const titleMatch = detailHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
                            const dateMatch = detailHtml.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
                            const venueMatch = detailHtml.match(/(?:at|@|venue:)\s*([^,\n]+)/i);
                            
                            if (titleMatch && dateMatch) {
                                const event = {
                                    title: titleMatch[1].trim(),
                                    name: titleMatch[1].trim(),
                                    date: this.parseDate(dateMatch[0]),
                                    venue: venueMatch ? venueMatch[1].trim() : "TBA",
                                    url: detailUrl,
                                    source: "Bearracuda",
                                    confidence: "high"
                                };
                                
                                // Extract city from venue
                                const city = this.extractCityFromLocation(event.venue);
                                if (city) {
                                    event.calendar = city;
                                }
                                
                                events.push(event);
                            }
                        } catch (detailError) {
                            this.logger.log(`Error fetching Bearracuda detail page: ${detailError.message}`);
                        }
                    }
                }
            } catch (error) {
                this.logger.log(`Error parsing Bearracuda URL ${url}: ${error.message}`);
            }
        }
        
        this.logger.log(`Found ${events.length} Bearracuda events`);
        return events;
    }
    
    // Parse Megawoof with Eventbrite structure
    async parseMegawoof(urls, config) {
        const events = [];
        
        for (const url of urls) {
            try {
                this.logger.log(`Fetching Megawoof URL: ${url}`);
                const request = new Request(url);
                const html = await request.loadString();
                
                // Parse Eventbrite organizer page
                // Look for event cards
                const cardPattern = /<article[^>]*class="[^"]*event-card[^"]*"[^>]*>[\s\S]*?<\/article>/gi;
                const linkPattern = /<a[^>]*href="([^"]*eventbrite[^"]*)"[^>]*>/gi;
                
                // First try structured approach
                let cardMatches = html.match(cardPattern) || [];
                
                if (cardMatches.length === 0) {
                    // Fallback: just find all Eventbrite links
                    let linkMatch;
                    const eventLinks = [];
                    while ((linkMatch = linkPattern.exec(html)) !== null) {
                        if (linkMatch[1].includes('/e/')) {
                            eventLinks.push(linkMatch[1]);
                        }
                    }
                    
                    // Process each event link
                    for (const eventUrl of eventLinks.slice(0, 10)) { // Limit to 10 events
                        try {
                            const eventRequest = new Request(eventUrl);
                            const eventHtml = await eventRequest.loadString();
                            
                            const event = this.parseEventbriteEvent(eventHtml, eventUrl);
                            if (event) {
                                events.push(event);
                            }
                        } catch (eventError) {
                            this.logger.log(`Error fetching Eventbrite event: ${eventError.message}`);
                        }
                    }
                } else {
                    // Process event cards
                    for (const card of cardMatches) {
                        // Extract basic info from card
                        const titleMatch = card.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
                        const dateMatch = card.match(/(\w+,?\s+\w+\s+\d{1,2})/i);
                        const linkMatch = card.match(/href="([^"]*)"/);
                        
                        if (titleMatch && linkMatch) {
                            const eventUrl = linkMatch[1];
                            
                            try {
                                const eventRequest = new Request(eventUrl);
                                const eventHtml = await eventRequest.loadString();
                                
                                const event = this.parseEventbriteEvent(eventHtml, eventUrl);
                                if (event) {
                                    events.push(event);
                                }
                            } catch (eventError) {
                                this.logger.log(`Error fetching Eventbrite event from card: ${eventError.message}`);
                            }
                        }
                    }
                }
                
            } catch (error) {
                this.logger.log(`Error parsing Megawoof URL ${url}: ${error.message}`);
            }
        }
        
        this.logger.log(`Found ${events.length} Megawoof events`);
        return events;
    }
    
    // Helper: Parse individual Eventbrite event page
    parseEventbriteEvent(html, url) {
        try {
            // Look for structured data first
            const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
            
            if (jsonLdMatch) {
                try {
                    const structuredData = JSON.parse(jsonLdMatch[1]);
                    
                    if (structuredData['@type'] === 'Event') {
                        const event = {
                            title: structuredData.name || "Megawoof",
                            name: structuredData.name || "Megawoof",
                            date: this.parseDate(structuredData.startDate),
                            endDate: this.parseDate(structuredData.endDate),
                            venue: structuredData.location?.name || "TBA",
                            address: structuredData.location?.address?.streetAddress || "",
                            description: structuredData.description || "",
                            url: url,
                            source: "Megawoof",
                            confidence: "high"
                        };
                        
                        // Extract city from location data
                        const cityText = `${event.venue} ${event.address} ${structuredData.location?.address?.addressLocality || ''} ${structuredData.location?.address?.addressRegion || ''}`;
                        const city = this.extractCityFromLocation(cityText);
                        if (city) {
                            event.calendar = city;
                        }
                        
                        // Extract time if available
                        if (structuredData.startDate) {
                            const timeMatch = structuredData.startDate.match(/T(\d{2}):(\d{2})/);
                            if (timeMatch) {
                                event.time = `${timeMatch[1]}:${timeMatch[2]}`;
                            }
                        }
                        
                        return event;
                    }
                } catch (parseError) {
                    this.logger.log(`Error parsing Eventbrite structured data: ${parseError.message}`);
                }
            }
            
            // Fallback to HTML parsing
            const titleMatch = html.match(/<h1[^>]*class="[^"]*listing-hero-title[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                               html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
            const dateMatch = html.match(/<time[^>]*datetime="([^"]+)"[^>]*>/i) ||
                             html.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
            const venueMatch = html.match(/<p[^>]*class="[^"]*venue-name[^"]*"[^>]*>([^<]+)<\/p>/i) ||
                              html.match(/(?:venue|location):\s*([^<\n]+)/i);
            
            if (titleMatch) {
                const event = {
                    title: titleMatch[1].trim(),
                    name: titleMatch[1].trim(),
                    venue: venueMatch ? venueMatch[1].trim() : "TBA",
                    url: url,
                    source: "Megawoof",
                    confidence: "medium"
                };
                
                if (dateMatch) {
                    event.date = this.parseDate(dateMatch[1] || dateMatch[0]);
                }
                
                // Try to extract city from title or venue
                const city = this.extractCityFromLocation(`${event.title} ${event.venue}`);
                if (city) {
                    event.calendar = city;
                }
                
                return event;
            }
            
        } catch (error) {
            this.logger.log(`Error parsing Eventbrite event page: ${error.message}`);
        }
        
        return null;
    }
    
    // Helper: Strip HTML tags
    stripHtml(html) {
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    
    // Main parsing orchestrator
    async parseAllSources() {
        const input = await this.loadInput();
        const allEvents = [];
        const results = {
            sources: [],
            totalEvents: 0,
            byCity: {},
            errors: []
        };
        
        for (const parserConfig of input.parsers) {
            this.logger.log(`Processing ${parserConfig.name}`);
            
            try {
                let events = [];
                
                // Call appropriate parser
                switch (parserConfig.parser) {
                    case 'furball':
                        events = await this.perfDebugger.wrap(
                            this.parseFurball.bind(this),
                            [parserConfig.urls, parserConfig]
                        );
                        break;
                    case 'rockbar':
                        events = await this.perfDebugger.wrap(
                            this.parseRockbar.bind(this),
                            [parserConfig.urls, parserConfig]
                        );
                        break;
                    case 'bearracuda':
                        events = await this.perfDebugger.wrap(
                            this.parseBearracuda.bind(this),
                            [parserConfig.urls, parserConfig]
                        );
                        break;
                    case 'megawoof':
                        events = await this.perfDebugger.wrap(
                            this.parseMegawoof.bind(this),
                            [parserConfig.urls, parserConfig]
                        );
                        break;
                    default:
                        this.logger.log(`Unknown parser: ${parserConfig.parser}`);
                }
                
                // Add source tracking and not-checked flag
                events.forEach(event => {
                    event.parser = parserConfig.parser;
                    event.sourceName = parserConfig.name;
                    
                    if (input.config?.notCheckedFlag) {
                        event.notChecked = true;
                    }
                });
                
                allEvents.push(...events);
                
                results.sources.push({
                    name: parserConfig.name,
                    parser: parserConfig.parser,
                    eventsFound: events.length,
                    urls: parserConfig.urls
                });
                
                this.logger.log(`Found ${events.length} events from ${parserConfig.name}`);
                
            } catch (error) {
                this.logger.log(`Error processing ${parserConfig.name}: ${error.message}`);
                results.errors.push({
                    source: parserConfig.name,
                    error: error.message
                });
            }
        }
        
        // Organize by city
        for (const event of allEvents) {
            const city = event.calendar || 'unmatched';
            if (!results.byCity[city]) {
                results.byCity[city] = [];
            }
            results.byCity[city].push(event);
        }
        
        results.totalEvents = allEvents.length;
        
        // Save results
        const timestamp = new Date().toISOString().split('T')[0];
        this.jsonManager.write(`bear-events-v3-${timestamp}.json`, results);
        
        // Write logs and performance data
        this.logger.writeLogs(this.LOG_FILE);
        this.perfDebugger.appendPerformanceDataToFile(this.PERFORMANCE_FILE);
        
        return results;
    }
    
    // Generate detailed report
    generateReport(results) {
        let report = `Bear Event Scraper V3 Report (Precise Parsing)\n`;
        report += `Generated: ${new Date().toLocaleString()}\n`;
        report += `${'='.repeat(60)}\n\n`;
        
        report += `SUMMARY\n`;
        report += `${'='.repeat(60)}\n`;
        report += `Total Events Found: ${results.totalEvents}\n`;
        report += `Cities Covered: ${Object.keys(results.byCity).length}\n\n`;
        
        report += `BY SOURCE\n`;
        report += `${'='.repeat(60)}\n`;
        for (const source of results.sources) {
            report += `${source.name}: ${source.eventsFound} events\n`;
            report += `  Parser: ${source.parser}\n`;
            report += `  URLs: ${source.urls.join(', ')}\n\n`;
        }
        
        report += `BY CITY\n`;
        report += `${'='.repeat(60)}\n`;
        for (const [city, events] of Object.entries(results.byCity)) {
            report += `\n${city.toUpperCase()}: ${events.length} events\n`;
            report += `${'-'.repeat(40)}\n`;
            
            // Sort events by date
            const sortedEvents = events.sort((a, b) => {
                const dateA = a.date ? new Date(a.date) : new Date();
                const dateB = b.date ? new Date(b.date) : new Date();
                return dateA - dateB;
            });
            
            // List all events with details
            sortedEvents.forEach((event, index) => {
                const dateStr = event.date ? new Date(event.date).toLocaleDateString() : 'No date';
                const timeStr = event.time || '';
                
                report += `\n${index + 1}. ${event.title || event.name}\n`;
                report += `   Date: ${dateStr} ${timeStr}\n`;
                report += `   Venue: ${event.venue || 'TBA'}\n`;
                if (event.location) {
                    report += `   Address: ${event.location}\n`;
                }
                report += `   Source: ${event.sourceName} (${event.confidence} confidence)\n`;
                if (event.price) {
                    report += `   Price: ${event.price}\n`;
                }
                if (event.description) {
                    report += `   Description: ${event.description.substring(0, 100)}...\n`;
                }
                if (event.notChecked) {
                    report += `   ⚠️  Needs verification\n`;
                }
            });
        }
        
        if (results.errors.length > 0) {
            report += `\n\nERRORS\n`;
            report += `${'='.repeat(60)}\n`;
            for (const error of results.errors) {
                report += `${error.source}: ${error.error}\n`;
            }
        }
        
        // Save report
        const timestamp = new Date().toISOString().split('T')[0];
        const fm = FileManager.local();
        const reportPath = fm.documentsDirectory() + `/bear-event-scraper-v3-report-${timestamp}.txt`;
        fm.writeString(reportPath, report);
        
        return report;
    }
    
    // Create widget for display
    async createWidget(results) {
        const widget = new ListWidget();
        widget.backgroundColor = new Color('#1a1a1a');
        
        // Title with version
        const title = widget.addText('🐻 Event Scraper V3');
        title.font = Font.boldSystemFont(16);
        title.textColor = Color.white();
        
        widget.addSpacer(8);
        
        // Stats grid
        const statsStack = widget.addStack();
        statsStack.layoutHorizontally();
        
        // Total events
        const totalStack = statsStack.addStack();
        totalStack.layoutVertically();
        const totalLabel = totalStack.addText('Events');
        totalLabel.font = Font.systemFont(10);
        totalLabel.textColor = Color.gray();
        const totalValue = totalStack.addText(`${results.totalEvents}`);
        totalValue.font = Font.boldSystemFont(20);
        totalValue.textColor = new Color('#4a90e2');
        
        statsStack.addSpacer(20);
        
        // Cities
        const citiesStack = statsStack.addStack();
        citiesStack.layoutVertically();
        const citiesLabel = citiesStack.addText('Cities');
        citiesLabel.font = Font.systemFont(10);
        citiesLabel.textColor = Color.gray();
        const citiesValue = citiesStack.addText(`${Object.keys(results.byCity).length}`);
        citiesValue.font = Font.boldSystemFont(20);
        citiesValue.textColor = new Color('#7ed321');
        
        widget.addSpacer(8);
        
        // Source summary
        const sourceStack = widget.addStack();
        sourceStack.layoutHorizontally();
        
        for (const source of results.sources.slice(0, 2)) {
            const sourceText = sourceStack.addText(`${source.name}: ${source.eventsFound}`);
            sourceText.font = Font.systemFont(11);
            sourceText.textColor = Color.lightGray();
            sourceStack.addSpacer(8);
        }
        
        widget.addSpacer();
        
        // Last update with precision indicator
        const updateStack = widget.addStack();
        updateStack.layoutHorizontally();
        const updateText = updateStack.addText(`Updated: ${new Date().toLocaleTimeString()}`);
        updateText.font = Font.systemFont(9);
        updateText.textColor = Color.gray();
        
        updateStack.addSpacer(4);
        
        const precisionText = updateStack.addText('●');
        precisionText.font = Font.systemFont(9);
        precisionText.textColor = new Color('#7ed321'); // Green for precise parsing
        
        return widget;
    }
}

// ===== MAIN EXECUTION =====

async function main() {
    const scraper = new BearEventScraperV3();
    
    try {
        // Parse all sources
        const results = await scraper.parseAllSources();
        
        // Generate report
        const report = scraper.generateReport(results);
        
        if (config.runsInWidget) {
            // Widget mode
            const widget = await scraper.createWidget(results);
            Script.setWidget(widget);
        } else {
            // App mode
            const alert = new Alert();
            alert.title = '🐻 Bear Event Scraper V3';
            alert.message = `Precise parsing complete!\n\nFound ${results.totalEvents} events from ${results.sources.length} sources across ${Object.keys(results.byCity).length} cities.\n\nThis version uses specific HTML patterns for each source.`;
            
            alert.addAction('View Detailed Report');
            alert.addAction('View Results JSON');
            alert.addAction('View Logs');
            alert.addAction('Done');
            
            const choice = await alert.presentAlert();
            
            if (choice === 0) {
                // View report
                QuickLook.present(report);
            } else if (choice === 1) {
                // View JSON
                QuickLook.present(JSON.stringify(results, null, 2));
            } else if (choice === 2) {
                // View logs
                const logs = scraper.logger.logs.join('\n');
                QuickLook.present(logs);
            }
        }
        
        Script.complete();
        
    } catch (error) {
        console.error('Fatal error:', error);
        const alert = new Alert();
        alert.title = 'Error';
        alert.message = `An error occurred: ${error.message}`;
        await alert.present();
    }
}

// Run the script
await main();
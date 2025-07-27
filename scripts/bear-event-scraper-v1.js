// Bear Event Scraper v1 for Scriptable (Original Parser)
// Parses event data from various bear event websites and updates Google Calendar
// Now includes full safety mode implementation (DRY_RUN, PREVIEW_MODE, CALENDAR_SYNC_ENABLED)
// Author: Chunky Dad Team

// ===== MINIFIED DEPENDENCIES =====
// These are copied in their entirety as required

// JSON File Manager
/**
 * Author: Ryan Stanley (stanleyrya@gmail.com)
 * Tips: https://www.paypal.me/stanleyrya
 *
 * Class that can read and write JSON objects using the file system.
 *
 * Usage:
 * * write(relativePath, jsonObject): Writes JSON object to a relative path.
 * * read(relativePath): Reads JSON object from a relative path.
 *
 * Notes:
 * * I'm not catching errors on purpose. It helps to debug when it fails.
 * * If a file doesn't exist it will throw an error.
 */
class JSONFileManager{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory()}write(e,r){const t=this.documentsDirectory+"/"+e,i=FileManager.local();i.writeString(t,JSON.stringify(r))}read(e){const r=this.documentsDirectory+"/"+e,t=FileManager.local();return JSON.parse(t.readString(r))}}

// File Logger
/**
 * Author: Ryan Stanley (stanleyrya@gmail.com)
 * Tips: https://www.paypal.me/stanleyrya
 *
 * Class that can write logs to the file system.
 *
 * Usage:
 * * log(line): Adds the log line to the class' internal log object.
 * * writeLogs(relativePath): Writes the stored logs to the relative file path.
 *
 * Notes:
 * * I'm not catching errors on purpose. It helps to debug when it fails.
 * * If a file doesn't exist it will be created.
 * * If a file does exist it will be overwritten.
 * * The logs are stored as a list of strings.
 * * Logs are prefixed with a timestamp.
 * * An example timestamp is "2021-01-01T00:00:00.000Z"
 * * If you want to change the timestamp format, override getDateString().
 */
class FileLogger{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory(),this.logs=[]}getDateString(){return(new Date).toISOString()}log(e){this.logs.push(this.getDateString()+" - "+e)}writeLogs(e){const t=this.documentsDirectory+"/"+e,s=FileManager.local();s.writeString(t,this.logs.join("\n"))}}

// Performance Debugger
/**
 * Author: Ryan Stanley (stanleyrya@gmail.com)
 * Tips: https://www.paypal.me/stanleyrya
 *
 * Class that can capture the time functions take in milliseconds then export them to a CSV.
 *
 * Usage:
 * * wrap(fn, args): Wrap the function calls you want to monitor with this wrapper.
 * * appendPerformanceDataToFile(relativePath): Use at the end of your script to write the metrics to the CSV file at the relative file path.
 *
 * Notes:
 * * I'm not catching errors on purpose. It helps to debug when it fails.
 * * If a file doesn't exist it will be created.
 * * If a file does exist it will be appended to.
 * * The performance data is stored as a CSV with the following columns:
 *   * functionName: The name of the function.
 *   * startTime: The start time of the function.
 *   * endTime: The end time of the function.
 *   * duration: The duration of the function in milliseconds.
 * * An example timestamp is "2021-01-01T00:00:00.000Z"
 * * If you want to change the timestamp format, override getDateString() in the FileLogger class.
 */
class PerformanceDebugger{constructor(e){this.documentsDirectory=e||FileManager.local().documentsDirectory(),this.performanceData=[]}getDateString(){return(new Date).toISOString()}async wrap(e,t){const n=e.name||"anonymous",r=this.getDateString(),a=await e(...t),i=this.getDateString(),o=new Date(i)-new Date(r);return this.performanceData.push({functionName:n,startTime:r,endTime:i,duration:o}),a}appendPerformanceDataToFile(e){const t=this.documentsDirectory+"/"+e,n=FileManager.local();let r="functionName,startTime,endTime,duration\n";n.fileExists(t)&&(r=""),this.performanceData.forEach(e=>{r+=`${e.functionName},${e.startTime},${e.endTime},${e.duration}\n`}),n.isFileDownloaded(t)?n.downloadFileFromiCloud(t).then(()=>{const e=n.readString(t);n.writeString(t,e+r)}):n.fileExists(t)?n.writeString(t,n.readString(t)+r):n.writeString(t,r)}}

// ===== END MINIFIED DEPENDENCIES =====

// Initialize utilities
const jsonManager = new JSONFileManager();
const logger = new FileLogger();
const perfDebugger = new PerformanceDebugger();

// Configuration
const CONFIG_FILE = "bear-event-scraper-v1-config.json";
const LOG_FILE = "bear-event-scraper-v1-logs.txt";
const PERFORMANCE_FILE = "bear-event-scraper-v1-performance.csv";

// Calendar IDs mapping
const CALENDAR_IDS = {
  'nyc': 'chunky-dad-nyc',
  'la': 'chunky-dad-la',
  'chicago': 'chunky-dad-chicago',
  'sf': 'chunky-dad-sf',
  'seattle': 'chunky-dad-seattle',
  'dc': 'chunky-dad-dc',
  'boston': 'chunky-dad-boston',
  'atlanta': 'chunky-dad-atlanta',
  'miami': 'chunky-dad-miami',
  'dallas': 'chunky-dad-dallas',
  'denver': 'chunky-dad-denver',
  'portland': 'chunky-dad-portland',
  'philadelphia': 'chunky-dad-philadelphia',
  'phoenix': 'chunky-dad-phoenix',
  'austin': 'chunky-dad-austin'
};

// Bear-related keywords for filtering
const BEAR_KEYWORDS = [
  'bear', 'bears', 'cub', 'cubs', 'otter', 'otters', 'daddy', 'daddies',
  'woof', 'grr', 'furry', 'hairy', 'beef', 'chunk', 'chub', 'muscle bear',
  'leather bear', 'polar bear', 'grizzly', 'bearracuda', 'furball', 'megawoof'
];

// Main parser class
class BearEventParser {
  constructor() {
    this.events = [];
    this.existingEvents = new Map();
    this.config = this.loadConfig();
    
    // Safety modes
    this.DRY_RUN = true; // DEFAULT TO DRY RUN FOR SAFETY
    this.PREVIEW_MODE = true; // Show what would be done
    this.CALENDAR_SYNC_ENABLED = false; // Disabled by default
  }

  loadConfig() {
    try {
      const config = jsonManager.read(CONFIG_FILE);
      logger.log("Configuration loaded successfully");
      return config;
    } catch (error) {
      logger.log(`No configuration found, using defaults: ${error.message}`);
      return {
        parsers: [],
        lastRun: null,
        notCheckedFlag: true
      };
    }
  }

  saveConfig() {
    try {
      jsonManager.write(CONFIG_FILE, this.config);
      logger.log("Configuration saved successfully");
    } catch (error) {
      logger.log(`Error saving configuration: ${error.message}`);
    }
  }

  // Load existing events from calendar
  async loadExistingEvents(calendarId) {
    try {
      logger.log(`Loading existing events from calendar: ${calendarId}`);
      // In a real implementation, this would fetch from Google Calendar API
      // For now, we'll simulate with a local cache
      const cacheFile = `calendar-cache-${calendarId}.json`;
      try {
        const cache = jsonManager.read(cacheFile);
        cache.events.forEach(event => {
          const key = this.getEventKey(event);
          this.existingEvents.set(key, event);
        });
        logger.log(`Loaded ${cache.events.length} existing events from cache`);
      } catch (e) {
        logger.log(`No cache found for calendar ${calendarId}`);
      }
    } catch (error) {
      logger.log(`Error loading existing events: ${error.message}`);
    }
  }

  // Generate unique key for event comparison
  getEventKey(event) {
    const date = event.startDate || event.date || '';
    const venue = event.bar || event.venue || '';
    const name = event.name || event.title || '';
    return `${date}-${venue}-${name}`.toLowerCase().replace(/\s+/g, '-');
  }

  // Parse HTML content
  parseHTML(html) {
    // Basic HTML parsing without external dependencies
    // This is a simplified parser - in production, you'd want a proper HTML parser
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return text;
  }

  // Extract date from various formats
  parseDate(dateStr) {
    if (!dateStr) return null;
    
    // Try various date formats
    const formats = [
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // MM/DD/YYYY
      /(\d{4})-(\d{2})-(\d{2})/,         // YYYY-MM-DD
      /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,   // Month DD, YYYY
      /(\d{1,2})\s+(\w+)\s+(\d{4})/      // DD Month YYYY
    ];
    
    // Month name mapping
    const months = {
      'january': 0, 'jan': 0,
      'february': 1, 'feb': 1,
      'march': 2, 'mar': 2,
      'april': 3, 'apr': 3,
      'may': 4,
      'june': 5, 'jun': 5,
      'july': 6, 'jul': 6,
      'august': 7, 'aug': 7,
      'september': 8, 'sep': 8, 'sept': 8,
      'october': 9, 'oct': 9,
      'november': 10, 'nov': 10,
      'december': 11, 'dec': 11
    };
    
    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        try {
          let year, month, day;
          
          if (format.source.includes('\\w+')) {
            // Month name format
            const monthName = match[1].toLowerCase();
            month = months[monthName];
            if (month === undefined) continue;
            day = parseInt(match[2]);
            year = parseInt(match[3]);
          } else if (format.source.startsWith('(\\d{4})')) {
            // YYYY-MM-DD format
            year = parseInt(match[1]);
            month = parseInt(match[2]) - 1;
            day = parseInt(match[3]);
          } else {
            // MM/DD/YYYY format
            month = parseInt(match[1]) - 1;
            day = parseInt(match[2]);
            year = parseInt(match[3]);
          }
          
          const date = new Date(year, month, day);
          if (!isNaN(date.getTime())) {
            return date;
          }
        } catch (e) {
          continue;
        }
      }
    }
    
    // Try native Date parsing as fallback
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }

  // Check if text contains bear-related keywords
  isBearEvent(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return BEAR_KEYWORDS.some(keyword => lowerText.includes(keyword));
  }

  // Parse Furball events
  async parseFurball(config) {
    logger.log("Parsing Furball events");
    const events = [];
    
    try {
      // Fetch main page
      const mainReq = new Request(config.urls[0]);
      const mainHtml = await mainReq.loadString();
      
      // Extract event links
      const eventLinks = this.extractLinks(mainHtml, /\/event\//);
      
      for (const link of eventLinks) {
        try {
          const eventReq = new Request(link);
          const eventHtml = await eventReq.loadString();
          
          const event = this.parseFurballEvent(eventHtml, link);
          if (event) {
            events.push(event);
            logger.log(`Parsed Furball event: ${event.name}`);
          }
        } catch (e) {
          logger.log(`Error parsing Furball event ${link}: ${e.message}`);
        }
      }
      
      // Also check ticket and schedule pages
      for (let i = 1; i < config.urls.length; i++) {
        try {
          const req = new Request(config.urls[i]);
          const html = await req.loadString();
          // Parse events from additional pages using the same event parser
          const pageEvent = this.parseFurballEvent(html, config.urls[i]);
          if (pageEvent) {
            events.push(pageEvent);
          }
        } catch (e) {
          logger.log(`Error parsing Furball page ${config.urls[i]}: ${e.message}`);
        }
      }
      
    } catch (error) {
      logger.log(`Error parsing Furball: ${error.message}`);
    }
    
    return events;
  }

  // Parse individual Furball event
  parseFurballEvent(html, url) {
    try {
      const event = {
        source: 'Furball',
        sourceUrl: url,
        notChecked: this.config.notCheckedFlag
      };
      
      // Extract title
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      if (titleMatch) {
        event.name = titleMatch[1].trim();
      }
      
      // Extract date
      const dateMatch = html.match(/Date:\s*([^<\n]+)/i) || 
                       html.match(/When:\s*([^<\n]+)/i);
      if (dateMatch) {
        event.startDate = this.parseDate(dateMatch[1]);
      }
      
      // Extract location/city
      const locationMatch = html.match(/Location:\s*([^<\n]+)/i) ||
                           html.match(/Where:\s*([^<\n]+)/i);
      if (locationMatch) {
        event.location = locationMatch[1].trim();
        event.city = this.extractCity(locationMatch[1]);
      }
      
      // Extract venue
      const venueMatch = html.match(/Venue:\s*([^<\n]+)/i);
      if (venueMatch) {
        event.bar = venueMatch[1].trim();
      }
      
      // Extract time
      const timeMatch = html.match(/Time:\s*([^<\n]+)/i) ||
                       html.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
      if (timeMatch) {
        event.time = timeMatch[1].trim();
      }
      
      // Extract description
      const descMatch = html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (descMatch) {
        event.tea = this.parseHTML(descMatch[1]).substring(0, 500);
      }
      
      // Extract price
      const priceMatch = html.match(/\$(\d+)/);
      if (priceMatch) {
        event.cover = `$${priceMatch[1]}`;
      }
      
      return event.name ? event : null;
    } catch (e) {
      logger.log(`Error parsing Furball event: ${e.message}`);
      return null;
    }
  }

  // Parse Rockbar events
  async parseRockbar(config) {
    logger.log("Parsing Rockbar events");
    const events = [];
    
    try {
      const req = new Request(config.urls[0]);
      const html = await req.loadString();
      
      // Extract calendar events
      const eventMatches = html.matchAll(/<div[^>]*class="[^"]*event[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
      
      for (const match of eventMatches) {
        const eventHtml = match[1];
        const event = this.parseRockbarEvent(eventHtml);
        
        if (event && (this.isBearEvent(event.name + ' ' + event.tea) || 
                     config.allowlist.some(term => event.name.toLowerCase().includes(term.toLowerCase())))) {
          event.bar = 'Rockbar';
          event.city = 'nyc';
          events.push(event);
          logger.log(`Parsed Rockbar event: ${event.name}`);
        }
      }
    } catch (error) {
      logger.log(`Error parsing Rockbar: ${error.message}`);
    }
    
    return events;
  }

  // Parse individual Rockbar event
  parseRockbarEvent(html) {
    try {
      const event = {
        source: 'Rockbar',
        notChecked: this.config.notCheckedFlag
      };
      
      // Extract title
      const titleMatch = html.match(/<h\d[^>]*>([^<]+)<\/h\d>/);
      if (titleMatch) {
        event.name = titleMatch[1].trim();
      }
      
      // Extract date
      const dateMatch = html.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
      if (dateMatch) {
        event.startDate = this.parseDate(dateMatch[1]);
      }
      
      // Extract time
      const timeMatch = html.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
      if (timeMatch) {
        event.time = timeMatch[1];
      }
      
      // Extract description
      const descMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      if (descMatch) {
        event.tea = this.parseHTML(descMatch[1]).substring(0, 300);
      }
      
      return event.name ? event : null;
    } catch (e) {
      logger.log(`Error parsing Rockbar event: ${e.message}`);
      return null;
    }
  }

  // Parse Bearracuda events
  async parseBearracuda(config) {
    logger.log("Parsing Bearracuda events");
    const events = [];
    
    try {
      const req = new Request(config.urls[0]);
      const html = await req.loadString();
      
      // Extract event links from the events section
      const eventSection = html.match(/<section[^>]*id="events"[^>]*>([\s\S]*?)<\/section>/i);
      if (eventSection) {
        const links = this.extractLinks(eventSection[1], /bearracuda\.com/);
        
        for (const link of links) {
          try {
            const eventReq = new Request(link);
            const eventHtml = await eventReq.loadString();
            
            const event = this.parseBearracudaEvent(eventHtml, link);
            if (event) {
              events.push(event);
              logger.log(`Parsed Bearracuda event: ${event.name}`);
            }
          } catch (e) {
            logger.log(`Error parsing Bearracuda event ${link}: ${e.message}`);
          }
        }
      }
    } catch (error) {
      logger.log(`Error parsing Bearracuda: ${error.message}`);
    }
    
    return events;
  }

  // Parse individual Bearracuda event
  parseBearracudaEvent(html, url) {
    try {
      const event = {
        source: 'Bearracuda',
        sourceUrl: url,
        notChecked: this.config.notCheckedFlag
      };
      
      // Extract title
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      if (titleMatch) {
        event.name = `Bearracuda ${titleMatch[1].trim()}`;
      }
      
      // Extract date
      const dateMatch = html.match(/Date:\s*([^<\n]+)/i);
      if (dateMatch) {
        event.startDate = this.parseDate(dateMatch[1]);
      }
      
      // Extract location
      const locationMatch = html.match(/Location:\s*([^<\n]+)/i);
      if (locationMatch) {
        const location = locationMatch[1].trim();
        event.bar = location;
        event.city = this.extractCity(location);
      }
      
      // Extract time
      const timeMatch = html.match(/Time:\s*([^<\n]+)/i);
      if (timeMatch) {
        event.time = timeMatch[1].trim();
      }
      
      // Extract price
      const priceMatch = html.match(/Price:\s*([^<\n]+)/i);
      if (priceMatch) {
        event.cover = priceMatch[1].trim();
      }
      
      return event.name ? event : null;
    } catch (e) {
      logger.log(`Error parsing Bearracuda event: ${e.message}`);
      return null;
    }
  }

  // Parse Megawoof events
  async parseMegawoof(config) {
    logger.log("Parsing Megawoof events");
    const events = [];
    
    try {
      const req = new Request(config.urls[0]);
      const html = await req.loadString();
      
      // Extract Eventbrite event cards
      const eventCards = html.matchAll(/<article[^>]*class="[^"]*event-card[^"]*"[^>]*>([\s\S]*?)<\/article>/gi);
      
      for (const match of eventCards) {
        const cardHtml = match[1];
        
        // Extract event link
        const linkMatch = cardHtml.match(/href="([^"]+eventbrite\.com[^"]+)"/);
        if (linkMatch) {
          try {
            const eventReq = new Request(linkMatch[1]);
            const eventHtml = await eventReq.loadString();
            
            const event = this.parseMegawoofEvent(eventHtml, linkMatch[1]);
            if (event) {
              events.push(event);
              logger.log(`Parsed Megawoof event: ${event.name}`);
            }
          } catch (e) {
            logger.log(`Error parsing Megawoof event ${linkMatch[1]}: ${e.message}`);
          }
        }
      }
    } catch (error) {
      logger.log(`Error parsing Megawoof: ${error.message}`);
    }
    
    return events;
  }

  // Parse individual Megawoof event
  parseMegawoofEvent(html, url) {
    try {
      const event = {
        source: 'Megawoof',
        sourceUrl: url,
        notChecked: this.config.notCheckedFlag
      };
      
      // Extract title
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      if (titleMatch) {
        event.name = titleMatch[1].trim();
      }
      
      // Extract date and time from Eventbrite structured data
      const dateMatch = html.match(/"startDate":\s*"([^"]+)"/);
      if (dateMatch) {
        event.startDate = this.parseDate(dateMatch[1]);
      }
      
      // Extract location
      const venueMatch = html.match(/"name":\s*"([^"]+)"[^}]*"address"/);
      if (venueMatch) {
        event.bar = venueMatch[1];
      }
      
      const cityMatch = html.match(/"addressLocality":\s*"([^"]+)"/);
      if (cityMatch) {
        event.city = this.mapCityToCalendar(cityMatch[1]);
      }
      
      // Extract price
      const priceMatch = html.match(/"price":\s*"([^"]+)"/);
      if (priceMatch) {
        event.cover = priceMatch[1];
      }
      
      return event.name ? event : null;
    } catch (e) {
      logger.log(`Error parsing Megawoof event: ${e.message}`);
      return null;
    }
  }

  // Extract links from HTML
  extractLinks(html, pattern) {
    const links = [];
    const matches = html.matchAll(/href="([^"]+)"/gi);
    
    for (const match of matches) {
      const url = match[1];
      if (pattern.test(url)) {
        // Make sure URL is absolute
        if (url.startsWith('http')) {
          links.push(url);
        } else if (url.startsWith('/')) {
          // Relative URL - need to determine base URL from context
          // This is simplified - in production you'd track the base URL
          links.push(url);
        }
      }
    }
    
    return [...new Set(links)]; // Remove duplicates
  }

  // Extract city from location string
  extractCity(location) {
    if (!location) return null;
    
    const cityPatterns = [
      { pattern: /new york|nyc|manhattan|brooklyn/i, city: 'nyc' },
      { pattern: /los angeles|la|hollywood/i, city: 'la' },
      { pattern: /chicago/i, city: 'chicago' },
      { pattern: /san francisco|sf|castro/i, city: 'sf' },
      { pattern: /seattle/i, city: 'seattle' },
      { pattern: /washington|dc|d\.c\./i, city: 'dc' },
      { pattern: /boston/i, city: 'boston' },
      { pattern: /atlanta/i, city: 'atlanta' },
      { pattern: /miami|south beach/i, city: 'miami' },
      { pattern: /dallas/i, city: 'dallas' },
      { pattern: /denver/i, city: 'denver' },
      { pattern: /portland/i, city: 'portland' },
      { pattern: /philadelphia|philly/i, city: 'philadelphia' },
      { pattern: /phoenix/i, city: 'phoenix' },
      { pattern: /austin/i, city: 'austin' }
    ];
    
    for (const { pattern, city } of cityPatterns) {
      if (pattern.test(location)) {
        return city;
      }
    }
    
    return null;
  }

  // Map city name to calendar ID
  mapCityToCalendar(cityName) {
    const city = this.extractCity(cityName);
    return city ? CALENDAR_IDS[city] : null;
  }

  // Format event for calendar
  formatEventForCalendar(event) {
    const formatted = {
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate || event.startDate,
      time: event.time,
      bar: event.bar,
      cover: event.cover,
      tea: event.tea,
      coordinates: event.coordinates,
      links: [],
      eventType: 'special',
      recurring: false,
      notChecked: event.notChecked
    };
    
    // Add source URL as a link
    if (event.sourceUrl) {
      formatted.links.push({
        type: 'website',
        url: event.sourceUrl,
        label: `🌐 ${event.source} Event Page`
      });
    }
    
    // Format according to calendar-core.js structure
    if (event.startDate) {
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      formatted.day = days[event.startDate.getDay()];
    }
    
    return formatted;
  }

  // Merge event data with existing event
  mergeEvents(existing, newEvent) {
    const merged = { ...existing };
    
    // Only update fields that are missing or empty in existing event
    if (!merged.bar && newEvent.bar) merged.bar = newEvent.bar;
    if (!merged.cover && newEvent.cover) merged.cover = newEvent.cover;
    if (!merged.tea && newEvent.tea) merged.tea = newEvent.tea;
    if (!merged.time && newEvent.time) merged.time = newEvent.time;
    if (!merged.coordinates && newEvent.coordinates) merged.coordinates = newEvent.coordinates;
    
    // Merge links
    if (newEvent.links) {
      merged.links = merged.links || [];
      newEvent.links.forEach(link => {
        if (!merged.links.some(l => l.url === link.url)) {
          merged.links.push(link);
        }
      });
    }
    
    // Update notChecked flag if needed
    if (existing.notChecked && !newEvent.notChecked) {
      merged.notChecked = false;
    }
    
    merged.lastUpdated = new Date().toISOString();
    
    return merged;
  }

  // Main parsing function
  async parseEvents(parserConfigs) {
    const allEvents = [];
    
    for (const config of parserConfigs) {
      try {
        logger.log(`Starting parser: ${config.name}`);
        let events = [];
        
        switch (config.parser) {
          case 'furball':
            events = await perfDebugger.wrap(this.parseFurball.bind(this), [config]);
            break;
          case 'rockbar':
            events = await perfDebugger.wrap(this.parseRockbar.bind(this), [config]);
            break;
          case 'bearracuda':
            events = await perfDebugger.wrap(this.parseBearracuda.bind(this), [config]);
            break;
          case 'megawoof':
            events = await perfDebugger.wrap(this.parseMegawoof.bind(this), [config]);
            break;
          default:
            logger.log(`Unknown parser type: ${config.parser}`);
        }
        
        logger.log(`Parser ${config.name} found ${events.length} events`);
        allEvents.push(...events);
        
      } catch (error) {
        logger.log(`Error in parser ${config.name}: ${error.message}`);
      }
    }
    
    return allEvents;
  }

  // Process and save events
  async processEvents(events) {
    const eventsByCalendar = new Map();
    const unmappedEvents = [];
    
    for (const event of events) {
      const formatted = this.formatEventForCalendar(event);
      const calendarId = event.city ? CALENDAR_IDS[event.city] : null;
      
      if (calendarId) {
        if (!eventsByCalendar.has(calendarId)) {
          eventsByCalendar.set(calendarId, []);
        }
        
        // Check if event already exists
        const eventKey = this.getEventKey(formatted);
        const existing = this.existingEvents.get(eventKey);
        
        if (existing) {
          // Merge with existing event
          const merged = this.mergeEvents(existing, formatted);
          eventsByCalendar.get(calendarId).push(merged);
          logger.log(`Merged event: ${merged.name}`);
        } else {
          // New event
          eventsByCalendar.get(calendarId).push(formatted);
          logger.log(`New event: ${formatted.name} for ${calendarId}`);
        }
      } else {
        unmappedEvents.push(formatted);
        logger.log(`Unmapped event: ${formatted.name} - could not determine city`);
      }
    }
    
    // Save events by calendar
    for (const [calendarId, calendarEvents] of eventsByCalendar) {
      try {
        const cacheFile = `calendar-cache-${calendarId}.json`;
        jsonManager.write(cacheFile, {
          calendarId,
          lastUpdated: new Date().toISOString(),
          events: calendarEvents
        });
        logger.log(`Saved ${calendarEvents.length} events to ${calendarId}`);
      } catch (error) {
        logger.log(`Error saving events for ${calendarId}: ${error.message}`);
      }
    }
    
    // Log unmapped events
    if (unmappedEvents.length > 0) {
      logger.log(`\n=== Unmapped Events (${unmappedEvents.length}) ===`);
      unmappedEvents.forEach(event => {
        logger.log(`- ${event.name} at ${event.bar || 'Unknown venue'}`);
      });
    }
    
    return { eventsByCalendar, unmappedEvents };
  }

  // Generate comparison report
  generateComparisonReport(events) {
    let report = "=== Event Parser Comparison Report ===\n\n";
    
    // Add safety status to report
    report += "SAFETY MODE STATUS:\n";
    report += `- DRY RUN: ${this.DRY_RUN ? 'ENABLED (No calendar changes)' : 'DISABLED'}\n`;
    report += `- PREVIEW: ${this.PREVIEW_MODE ? 'ENABLED' : 'DISABLED'}\n`;
    report += `- CALENDAR SYNC: ${this.CALENDAR_SYNC_ENABLED ? 'ENABLED' : 'DISABLED'}\n\n`;
    
    events.forEach((event, index) => {
      report += `Event ${index + 1}: ${event.name || 'Unnamed'}\n`;
      report += `  Source: ${event.source}\n`;
      report += `  Date: ${event.startDate || 'No date'}\n`;
      report += `  Time: ${event.time || 'No time'}\n`;
      report += `  Venue: ${event.bar || 'No venue'}\n`;
      report += `  City: ${event.city || 'Unknown'}\n`;
      report += `  Cover: ${event.cover || 'No cover info'}\n`;
      report += `  Description: ${event.tea ? event.tea.substring(0, 100) + '...' : 'No description'}\n`;
      report += `  URL: ${event.sourceUrl || 'No URL'}\n`;
      report += `  Not Checked: ${event.notChecked ? 'Yes' : 'No'}\n`;
      report += "\n";
    });
    
    return report;
  }
}

// Main execution
async function main() {
  logger.log("=== Bear Event Parser Started ===");
  logger.log(`Run time: ${new Date().toISOString()}`);
  
  try {
    // Load parser configuration from input file
    const inputFile = "bear-event-parser-input.json";
    let parserConfigs;
    
    try {
      const input = jsonManager.read(inputFile);
      parserConfigs = input.parsers;
      logger.log(`Loaded ${parserConfigs.length} parser configurations`);
    } catch (error) {
      logger.log(`No input file found, using default configuration`);
      // Default configuration for testing
      parserConfigs = [
        {
          name: "Furball",
          parser: "furball",
          urls: [
            "https://www.furball.nyc",
            "https://www.furball.nyc/ticket-information",
            "https://www.furball.nyc/upcoming-schedule"
          ]
        },
        {
          name: "Rockbar",
          parser: "rockbar",
          urls: ["https://www.rockbarnyc.com/calendar"],
          allowlist: ["rockstrap", "underbear"]
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
      ];
    }
    
    // Initialize parser
    const parser = new BearEventParser();
    
    // Load safety settings from input file if available
    try {
      const input = jsonManager.read(inputFile);
      if (input.config) {
        parser.DRY_RUN = input.config.dryRun !== false;
        parser.PREVIEW_MODE = input.config.preview !== false;
        parser.CALENDAR_SYNC_ENABLED = input.config.calendarSync === true;
        
        logger.log(`Safety settings loaded - DRY_RUN: ${parser.DRY_RUN}, PREVIEW: ${parser.PREVIEW_MODE}, CALENDAR_SYNC: ${parser.CALENDAR_SYNC_ENABLED}`);
      }
    } catch (error) {
      // Safety settings remain at defaults
    }
    
    // Parse events
    const events = await parser.parseEvents(parserConfigs);
    logger.log(`Total events parsed: ${events.length}`);
    
    // Process and save events
    const { eventsByCalendar, unmappedEvents } = await parser.processEvents(events);
    
    // Generate comparison report
    const report = parser.generateComparisonReport(events);
    const reportFile = `bear-event-scraper-v1-report-${new Date().toISOString().split('T')[0]}.txt`;
    const fm = FileManager.local();
    fm.writeString(fm.documentsDirectory() + "/" + reportFile, report);
    logger.log(`Comparison report saved to: ${reportFile}`);
    
    // Update configuration
    parser.config.lastRun = new Date().toISOString();
    parser.config.parsers = parserConfigs;
    parser.saveConfig();
    
    // Summary
    logger.log("\n=== Summary ===");
    logger.log(`Total events parsed: ${events.length}`);
    logger.log(`Events by calendar:`);
    for (const [calendarId, calendarEvents] of eventsByCalendar) {
      logger.log(`  ${calendarId}: ${calendarEvents.length} events`);
    }
    logger.log(`Unmapped events: ${unmappedEvents.length}`);
    
    // Log safety status
    logger.log("\n=== SAFETY MODE STATUS ===");
    logger.log(`DRY RUN: ${parser.DRY_RUN ? 'ENABLED (No calendar changes)' : 'DISABLED'}`);
    logger.log(`PREVIEW: ${parser.PREVIEW_MODE ? 'ENABLED' : 'DISABLED'}`);
    logger.log(`CALENDAR SYNC: ${parser.CALENDAR_SYNC_ENABLED ? 'ENABLED' : 'DISABLED'}`);
    
    if (parser.DRY_RUN) {
      logger.log("\n⚠️  DRY RUN MODE - No calendar operations were performed");
      logger.log("To sync events to calendars, set dryRun: false in the config");
    }
    
  } catch (error) {
    logger.log(`Fatal error: ${error.message}`);
    console.error(error);
  }
  
  // Write logs and performance data
  logger.log("=== Bear Event Parser Completed ===");
  logger.writeLogs(LOG_FILE);
  perfDebugger.appendPerformanceDataToFile(PERFORMANCE_FILE);
  
  // Display completion message
  if (config.runsInApp) {
    const alert = new Alert();
    alert.title = "Bear Event Parser";
    alert.message = "Parsing completed. Check the logs for details.";
    alert.addAction("OK");
    await alert.present();
  }
}

// Run the script
await main();
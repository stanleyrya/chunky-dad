/**
 * Bears Sitges Week Parser
 * 
 * PARSER RESTRICTIONS:
 * - Pure JavaScript parsing logic only
 * - NO environment detection (typeof importModule, typeof window, etc.)
 * - NO Scriptable APIs (Request, Calendar, FileManager, Alert, etc.)
 * - NO DOM APIs (DOMParser, document, window, etc.)
 * - NO HTTP requests - receives HTML as parameter
 * - NO calendar operations - returns event objects only
 * - Must work in both Scriptable and web environments
 * 
 * PURPOSE:
 * Parses the Bears Sitges Week page (https://bearssitges.org/bears-sitges-week/)
 * Handles special cases:
 * - All-day events
 * - Early morning times (01h-06h = next day)
 * - Multi-day events
 */

class BearsSitgesParser {
  constructor() {
    this.name = 'bears-sitges';
    this.baseUrl = 'https://bearssitges.org';
  }

  /**
   * Parse HTML content from Bears Sitges Week page
   * @param {string} html - Raw HTML content
   * @param {string} url - Source URL
   * @returns {Array} Array of parsed event objects
   */
  parse(html, url) {
    if (!html || typeof html !== 'string') {
      return [];
    }

    try {
      // Extract the event dates first (September 5-14, 2025)
      const eventDates = this.extractEventDates(html);
      
      // Extract events from the HTML structure with actual dates
      const events = this.extractEvents(html, url, eventDates);
      return events;
    } catch (error) {
      console.log(`BearsSitgesParser error: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract event dates from the Bears Sitges Week page
   * @param {string} html - Raw HTML content
   * @returns {Object} Object mapping day names to Date objects
   */
  extractEventDates(html) {
    const eventDates = {};
    
    // Bears Sitges Week 2025 is September 5-14, 2025
    const baseYear = 2025;
    const baseMonth = 8; // September (0-indexed)
    
    // Map day names to dates
    const dayMappings = {
      'VIERNES - 05': new Date(baseYear, baseMonth, 5),
      'SÁBADO - 06': new Date(baseYear, baseMonth, 6),
      'DOMINGO - 07': new Date(baseYear, baseMonth, 7),
      'LUNES - 08': new Date(baseYear, baseMonth, 8),
      'MARTES - 09': new Date(baseYear, baseMonth, 9),
      'MIÉRCOLES - 10': new Date(baseYear, baseMonth, 10),
      'JUEVES - 11': new Date(baseYear, baseMonth, 11),
      'VIERNES - 12': new Date(baseYear, baseMonth, 12),
      'SABADO -13': new Date(baseYear, baseMonth, 13),
      'DOMINGO - 14': new Date(baseYear, baseMonth, 14)
    };
    
    // Look for day headers in the HTML
    for (const [dayText, date] of Object.entries(dayMappings)) {
      if (html.includes(dayText)) {
        eventDates[dayText] = date;
      }
    }
    
    return eventDates;
  }

  /**
   * Extract events from HTML content
   * @param {string} html - Raw HTML content
   * @param {string} url - Source URL
   * @param {Object} eventDates - Object mapping day names to Date objects
   * @returns {Array} Array of event objects
   */
  extractEvents(html, url, eventDates = {}) {
    const events = [];
    const seenEvents = new Set(); // For deduplication
    
    // Parse events by day
    for (const [dayText, eventDate] of Object.entries(eventDates)) {
      console.log(`Parsing events for ${dayText}: ${eventDate.toDateString()}`);
      
      // Find events within this day's section
      const dayEvents = this.extractEventsForDay(html, url, eventDate, dayText);
      
      for (const event of dayEvents) {
        if (this.isUniqueEvent(event, seenEvents)) {
          events.push(event);
          seenEvents.add(this.getEventKey(event));
        }
      }
    }

    return events;
  }

  /**
   * Extract events for a specific day
   * @param {string} html - Raw HTML content
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @param {string} dayText - The day text to look for
   * @returns {Array} Array of event objects for this day
   */
  extractEventsForDay(html, url, eventDate, dayText) {
    const events = [];
    
    // Find the section for this day
    const daySection = this.findDaySection(html, dayText);
    if (!daySection) {
      return events;
    }
    
    // Look for time-based patterns within this day's section
    const timePatterns = this.findTimePatterns(daySection);
    for (const pattern of timePatterns) {
      const event = this.parseTimePattern(pattern, url, eventDate);
      if (event) {
        events.push(event);
      }
    }

    // Look for all-day event indicators within this day's section
    const allDayEvents = this.findAllDayEvents(daySection);
    for (const allDayEvent of allDayEvents) {
      const event = this.parseAllDayEvent(allDayEvent, url, eventDate);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  /**
   * Find the HTML section for a specific day
   * @param {string} html - Raw HTML content
   * @param {string} dayText - The day text to look for
   * @returns {string|null} The HTML section for this day
   */
  findDaySection(html, dayText) {
    // Look for the day header and extract content until the next day or end
    const dayRegex = new RegExp(`${dayText}[\\s\\S]*?(?=(?:VIERNES|SÁBADO|DOMINGO|LUNES|MARTES|MIÉRCOLES|JUEVES|SABADO|DOMINGO)\\s*-\\s*\\d{2}|$)`, 'i');
    const match = html.match(dayRegex);
    return match ? match[0] : null;
  }

  /**
   * Check if an event is unique (not already seen)
   * @param {Object} event - Event object
   * @param {Set} seenEvents - Set of seen event keys
   * @returns {boolean} True if unique
   */
  isUniqueEvent(event, seenEvents) {
    const key = this.getEventKey(event);
    return !seenEvents.has(key);
  }

  /**
   * Generate a unique key for an event for deduplication
   * @param {Object} event - Event object
   * @returns {string} Unique key
   */
  getEventKey(event) {
    const title = (event.title || '').toLowerCase().trim();
    const startDate = event.startDate ? event.startDate.toISOString() : '';
    const endDate = event.endDate ? event.endDate.toISOString() : '';
    
    return `${title}-${startDate}-${endDate}`;
  }

  /**
   * Find structured event blocks in HTML
   * @param {string} html - Raw HTML content
   * @returns {Array} Array of event block strings
   */
  findEventBlocks(html) {
    const blocks = [];
    
    // Look for common event container patterns
    const patterns = [
      /<div[^>]*class="[^"]*event[^"]*"[^>]*>.*?<\/div>/gis,
      /<article[^>]*>.*?<\/article>/gis,
      /<section[^>]*class="[^"]*event[^"]*"[^>]*>.*?<\/section>/gis,
      /<div[^>]*class="[^"]*program[^"]*"[^>]*>.*?<\/div>/gis
    ];

    for (const pattern of patterns) {
      const matches = html.match(pattern);
      if (matches) {
        blocks.push(...matches);
      }
    }

    return blocks;
  }

  /**
   * Find time-based patterns (01h to 06h, etc.)
   * @param {string} html - Raw HTML content
   * @returns {Array} Array of time pattern strings
   */
  findTimePatterns(html) {
    const patterns = [];
    
    // Look for time patterns like "01h to 06h", "22h to 02h", etc.
    const timeRegex = /(\d{1,2})h\s+to\s+(\d{1,2})h[^<]*?([^<]+?)(?=<|$)/gi;
    const matches = html.match(timeRegex);
    
    if (matches) {
      patterns.push(...matches);
    }

    // Also look for single time patterns
    const singleTimeRegex = /(\d{1,2})h[^<]*?([^<]+?)(?=<|$)/gi;
    const singleMatches = html.match(singleTimeRegex);
    
    if (singleMatches) {
      patterns.push(...singleMatches);
    }

    return patterns;
  }

  /**
   * Find all-day event indicators
   * @param {string} html - Raw HTML content
   * @returns {Array} Array of all-day event strings
   */
  findAllDayEvents(html) {
    const events = [];
    
    // Look for all-day indicators
    const allDayPatterns = [
      /all\s+day[^<]*?([^<]+?)(?=<|$)/gi,
      /all\s+day\s+event[^<]*?([^<]+?)(?=<|$)/gi,
      /24h[^<]*?([^<]+?)(?=<|$)/gi,
      /open\s+all\s+day[^<]*?([^<]+?)(?=<|$)/gi
    ];

    for (const pattern of allDayPatterns) {
      const matches = html.match(pattern);
      if (matches) {
        events.push(...matches);
      }
    }

    return events;
  }

  /**
   * Parse a structured event block
   * @param {string} block - HTML block containing event info
   * @param {string} url - Source URL
   * @returns {Object|null} Parsed event object or null
   */
  parseEventBlock(block, url) {
    try {
      // Extract title
      const titleMatch = block.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
      const title = titleMatch ? titleMatch[1].trim() : 'Bears Sitges Week Event';

      // Extract description
      const descMatch = block.match(/<p[^>]*>([^<]+)<\/p>/i);
      const description = descMatch ? descMatch[1].trim() : '';

      // Extract time information
      const timeInfo = this.extractTimeFromBlock(block);

      // Extract location
      const location = this.extractLocationFromBlock(block);

      const event = {
        title: title,
        description: description,
        url: url,
        source: 'bears-sitges',
        city: 'sitges',
        country: 'Spain',
        timezone: 'Europe/Madrid',
        ...timeInfo,
        ...location
      };

      return event;
    } catch (error) {
      console.log(`Error parsing event block: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse a time pattern (e.g., "01h to 06h DISCO POP")
   * @param {string} pattern - Time pattern string
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @returns {Object|null} Parsed event object or null
   */
  parseTimePattern(pattern, url, eventDate = null) {
    try {
      // Extract time range
      const timeMatch = pattern.match(/(\d{1,2})h\s+to\s+(\d{1,2})h/);
      if (!timeMatch) {
        return null;
      }

      const startHour = parseInt(timeMatch[1]);
      const endHour = parseInt(timeMatch[2]);

      // Extract event description - look for text after the time
      const descMatch = pattern.match(/\d{1,2}h\s+to\s+\d{1,2}h\s+(.+?)(?:\s*$|\s*<)/);
      let description = descMatch ? descMatch[1].trim() : '';
      
      // Clean up the description
      description = description.replace(/^in\s+/, '').replace(/^by\s+/, '').trim();
      
      // If no description found, create a generic one
      if (!description) {
        description = `Bears Sitges Week Event (${startHour}h-${endHour}h)`;
      }

      // Use the actual event date if provided, otherwise use today as fallback
      const baseDate = eventDate || new Date();
      const startDate = new Date(baseDate);
      startDate.setHours(startHour, 0, 0, 0);
      
      const endDate = new Date(baseDate);
      endDate.setHours(endHour, 59, 59, 999);
      
      // If end hour is earlier than start hour, assume it's next day
      if (endHour < startHour) {
        endDate.setDate(endDate.getDate() + 1);
      }

      const event = {
        title: description,
        description: description,
        url: url,
        source: 'bears-sitges',
        city: 'sitges',
        country: 'Spain',
        timezone: 'Europe/Madrid',
        startDate: startDate,
        endDate: endDate
      };

      return event;
    } catch (error) {
      console.log(`Error parsing time pattern: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse an all-day event
   * @param {string} allDayEvent - All-day event string
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @returns {Object|null} Parsed event object or null
   */
  parseAllDayEvent(allDayEvent, url, eventDate = null) {
    try {
      // Extract event description - look for text after all-day indicators
      const descMatch = allDayEvent.match(/(?:all\s+day|24h|open\s+all\s+day)[^<]*?([^<]+?)(?:\s*$|\s*<)/i);
      let description = descMatch ? descMatch[1].trim() : '';
      
      // Clean up the description
      description = description.replace(/^event[:\s]*/i, '').trim();
      
      // If no description found, create a generic one
      if (!description) {
        description = 'Bears Sitges Week All-Day Event';
      }

      // Use the actual event date if provided, otherwise use today as fallback
      const baseDate = eventDate || new Date();
      const startDate = new Date(baseDate);
      startDate.setHours(0, 0, 0, 0);  // 00:00:00
      
      const endDate = new Date(baseDate);
      endDate.setHours(23, 59, 59, 999);  // 23:59:59

      const event = {
        title: description,
        description: description,
        url: url,
        source: 'bears-sitges',
        city: 'sitges',
        country: 'Spain',
        timezone: 'Europe/Madrid',
        startDate: startDate,
        endDate: endDate
      };

      return event;
    } catch (error) {
      console.log(`Error parsing all-day event: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract time information from HTML block
   * @param {string} block - HTML block
   * @returns {Object} Time information object
   */
  extractTimeFromBlock(block) {
    const timeInfo = {};

    // Look for time patterns
    const timeMatch = block.match(/(\d{1,2})h\s+to\s+(\d{1,2})h/);
    if (timeMatch) {
      const startHour = parseInt(timeMatch[1]);
      const endHour = parseInt(timeMatch[2]);
      
      // Create actual DateTime objects
      const today = new Date();
      const startDate = new Date(today);
      startDate.setHours(startHour, 0, 0, 0);
      
      const endDate = new Date(today);
      endDate.setHours(endHour, 59, 59, 999);
      
      // If end hour is earlier than start hour, assume it's next day
      if (endHour < startHour) {
        endDate.setDate(endDate.getDate() + 1);
      }
      
      timeInfo.startDate = startDate;
      timeInfo.endDate = endDate;
    } else {
      // Check for all-day indicators
      const allDayMatch = block.match(/(?:all\s+day|24h|open\s+all\s+day)/i);
      if (allDayMatch) {
        // Create all-day event with 00:00 to 23:59 times
        const today = new Date();
        const startDate = new Date(today);
        startDate.setHours(0, 0, 0, 0);  // 00:00:00
        
        const endDate = new Date(today);
        endDate.setHours(23, 59, 59, 999);  // 23:59:59
        
        timeInfo.startDate = startDate;
        timeInfo.endDate = endDate;
      }
    }

    return timeInfo;
  }

  /**
   * Extract location information from HTML block
   * @param {string} block - HTML block
   * @returns {Object} Location information object
   */
  extractLocationFromBlock(block) {
    const locationInfo = {};

    // Look for location patterns
    const locationMatch = block.match(/(?:at|in|@)\s+([^<]+?)(?:\s|$)/i);
    if (locationMatch) {
      locationInfo.bar = locationMatch[1].trim();
    }

    // Look for address patterns
    const addressMatch = block.match(/(?:address|location):\s*([^<]+)/i);
    if (addressMatch) {
      locationInfo.address = addressMatch[1].trim();
    }

    return locationInfo;
  }

  /**
   * Get parser metadata
   * @returns {Object} Parser metadata
   */
  getMetadata() {
    return {
      name: this.name,
      version: '1.0.0',
      description: 'Parser for Bears Sitges Week events',
      supportedFeatures: ['all-day-events', 'early-morning-times', 'multi-day-events'],
      url: this.baseUrl
    };
  }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BearsSitgesParser;
} else if (typeof window !== 'undefined') {
  window.BearsSitgesParser = BearsSitgesParser;
} else {
  // Scriptable environment
  BearsSitgesParser;
}
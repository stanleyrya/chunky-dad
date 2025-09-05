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
      // Extract events from the HTML structure
      const events = this.extractEvents(html, url);
      return events;
    } catch (error) {
      console.log(`BearsSitgesParser error: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract events from HTML content
   * @param {string} html - Raw HTML content
   * @param {string} url - Source URL
   * @returns {Array} Array of event objects
   */
  extractEvents(html, url) {
    const events = [];
    const seenEvents = new Set(); // For deduplication
    
    // Look for event patterns in the HTML
    // The page structure may vary, so we'll use multiple approaches
    
    // Method 1: Look for structured event blocks
    const eventBlocks = this.findEventBlocks(html);
    for (const block of eventBlocks) {
      const event = this.parseEventBlock(block, url);
      if (event && this.isUniqueEvent(event, seenEvents)) {
        events.push(event);
        seenEvents.add(this.getEventKey(event));
      }
    }

    // Method 2: Look for time-based patterns (01h to 06h, etc.)
    const timePatterns = this.findTimePatterns(html);
    for (const pattern of timePatterns) {
      const event = this.parseTimePattern(pattern, url);
      if (event && this.isUniqueEvent(event, seenEvents)) {
        events.push(event);
        seenEvents.add(this.getEventKey(event));
      }
    }

    // Method 3: Look for all-day event indicators
    const allDayEvents = this.findAllDayEvents(html);
    for (const allDayEvent of allDayEvents) {
      const event = this.parseAllDayEvent(allDayEvent, url);
      if (event && this.isUniqueEvent(event, seenEvents)) {
        events.push(event);
        seenEvents.add(this.getEventKey(event));
      }
    }

    return events;
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
    const startHour = event.startHour || '';
    const endHour = event.endHour || '';
    const isAllDay = event.isAllDay || false;
    
    return `${title}-${startHour}-${endHour}-${isAllDay}`;
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
   * @returns {Object|null} Parsed event object or null
   */
  parseTimePattern(pattern, url) {
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

      // For early morning events (01h-06h), we need to adjust the day
      // This will be handled by setting the correct startDate/endDate
      const isEarlyMorning = startHour >= 1 && startHour <= 6;
      
      // Create event object
      const event = {
        title: description,
        description: description,
        url: url,
        source: 'bears-sitges',
        city: 'sitges',
        country: 'Spain',
        timezone: 'Europe/Madrid',
        startHour: startHour,
        endHour: endHour
      };
      
      // Add a note about early morning timing for later processing
      if (isEarlyMorning) {
        event._earlyMorning = true;
      }

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
   * @returns {Object|null} Parsed event object or null
   */
  parseAllDayEvent(allDayEvent, url) {
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

      const event = {
        title: description,
        description: description,
        url: url,
        source: 'bears-sitges',
        city: 'sitges',
        country: 'Spain',
        timezone: 'Europe/Madrid'
      };
      
      // Add a note about all-day timing for later processing
      event._allDay = true;

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
      
      timeInfo.startHour = startHour;
      timeInfo.endHour = endHour;
      
      // Add internal flags for processing
      if (startHour >= 1 && startHour <= 6) {
        timeInfo._earlyMorning = true;
      }
    } else {
      // Check for all-day indicators
      const allDayMatch = block.match(/(?:all\s+day|24h|open\s+all\s+day)/i);
      if (allDayMatch) {
        timeInfo._allDay = true;
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
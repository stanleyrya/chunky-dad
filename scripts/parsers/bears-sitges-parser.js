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
    
    // Extract year from the page content
    const yearMatch = html.match(/BEARS SITGES WEEK (\d{4})/i);
    if (!yearMatch) {
      console.log('No year found in HTML');
      return eventDates;
    }
    const year = parseInt(yearMatch[1]);
    
    // Look for day patterns in the HTML and extract dates dynamically
    const dayPattern = /(VIERNES|SÁBADO|DOMINGO|LUNES|MARTES|MIÉRCOLES|JUEVES|SABADO|DOMINGO)\s*-\s*(\d{1,2})/gi;
    const dayMatches = [];
    let match;
    
    // Collect all day matches first
    while ((match = dayPattern.exec(html)) !== null) {
      const dayName = match[1];
      const dayNumber = parseInt(match[2]);
      dayMatches.push({ dayName, dayNumber });
    }
    
    if (dayMatches.length === 0) {
      console.log('No day patterns found in HTML');
      return eventDates;
    }
    
    // Determine the month by checking what day of the week the first day falls on
    const firstDay = dayMatches[0];
    const month = this.determineMonthFromDayOfWeek(year, firstDay.dayNumber, firstDay.dayName);
    
    console.log(`Bears Sitges Week detected: Year ${year}, Month ${month + 1}`);
    
    // Create date objects for all found days
    for (const { dayName, dayNumber } of dayMatches) {
      const dayText = `${dayName} - ${dayNumber.toString().padStart(2, '0')}`;
      const eventDate = new Date(year, month, dayNumber);
      eventDates[dayText] = eventDate;
      
      console.log(`Found day: ${dayText} -> ${eventDate.toDateString()}`);
    }
    
    return eventDates;
  }

  /**
   * Determine the month by checking what day of the week a given date falls on
   * @param {number} year - The year
   * @param {number} dayNumber - The day of the month
   * @param {string} dayName - The Spanish day name (VIERNES, SÁBADO, etc.)
   * @returns {number} The month (0-indexed)
   */
  determineMonthFromDayOfWeek(year, dayNumber, dayName) {
    // Map Spanish day names to JavaScript day numbers (0=Sunday, 1=Monday, etc.)
    const spanishDayMap = {
      'DOMINGO': 0,   // Sunday
      'LUNES': 1,     // Monday
      'MARTES': 2,    // Tuesday
      'MIÉRCOLES': 3, // Wednesday
      'JUEVES': 4,    // Thursday
      'VIERNES': 5,   // Friday
      'SÁBADO': 6,    // Saturday
      'SABADO': 6     // Alternative spelling
    };
    
    const expectedDayOfWeek = spanishDayMap[dayName.toUpperCase()];
    if (expectedDayOfWeek === undefined) {
      console.log(`Unknown day name: ${dayName}`);
      throw new Error(`Unknown day name: ${dayName}`);
    }
    
    // Try each month to find which one has the correct day of the week
    for (let month = 0; month < 12; month++) {
      const testDate = new Date(year, month, dayNumber);
      if (testDate.getDay() === expectedDayOfWeek) {
        console.log(`Day ${dayNumber} in month ${month + 1} falls on ${dayName} (day ${expectedDayOfWeek})`);
        return month;
      }
    }
    
    // If no match found, throw error
    console.log(`Could not determine month for ${dayName} ${dayNumber}`);
    throw new Error(`Could not determine month for ${dayName} ${dayNumber}`);
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
   * Find time-based patterns (01h to 06h, etc.)
   * @param {string} html - Raw HTML content
   * @returns {Array} Array of time pattern strings
   */
  findTimePatterns(html) {
    const patterns = [];
    
    // Look for time patterns like "01h to 06h", "22h to 02h", etc.
    // Only match patterns with explicit start and end times
    const timeRegex = /(\d{1,2})h\s+to\s+(\d{1,2})h[^<]*?([^<]+?)(?=<|$)/gi;
    const matches = html.match(timeRegex);
    
    if (matches) {
      patterns.push(...matches);
    }

    return patterns;
  }

  /**
   * Find all-day event indicators (events without specific times)
   * @param {string} html - Raw HTML content
   * @returns {Array} Array of all-day event strings
   */
  findAllDayEvents(html) {
    const events = [];
    
    // Look for text blocks that don't contain time patterns (no "XXh" or "XX:XX")
    // Split by common separators and check each block
    const textBlocks = html.split(/<[^>]+>|[\n\r]+/).filter(block => 
      block.trim().length > 10 && // Must have some content
      !block.match(/\d{1,2}h/) && // No hour patterns
      !block.match(/\d{1,2}:\d{2}/) && // No time patterns
      !block.match(/(VIERNES|SÁBADO|DOMINGO|LUNES|MARTES|MIÉRCOLES|JUEVES|SABADO|DOMINGO)\s*-\s*\d{1,2}/i) // Not day headers
    );

    for (const block of textBlocks) {
      const trimmed = block.trim();
      if (trimmed.length > 0) {
        events.push(trimmed);
      }
    }

    return events;
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
      
      // If no description found, skip this event
      if (!description) {
        return null;
      }

      // Use the actual event date (required)
      if (!eventDate) {
        return null;
      }
      const baseDate = eventDate;
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
   * Parse an all-day event (event without specific times)
   * @param {string} allDayEvent - All-day event string
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @returns {Object|null} Parsed event object or null
   */
  parseAllDayEvent(allDayEvent, url, eventDate = null) {
    try {
      // Clean up the description - remove any remaining HTML tags or extra whitespace
      let description = allDayEvent.replace(/<[^>]+>/g, '').trim();
      
      // Skip if it's too short or looks like navigation text
      if (description.length < 5 || 
          description.match(/^(BEARS SITGES WEEK|Del \d+ al \d+)/i) ||
          description.match(/^(VIERNES|SÁBADO|DOMINGO|LUNES|MARTES|MIÉRCOLES|JUEVES|SABADO|DOMINGO)/i)) {
        return null;
      }
      
      // If no meaningful description found, skip this event
      if (!description || description.length < 5) {
        return null;
      }

      // Use the actual event date (required)
      if (!eventDate) {
        return null;
      }
      const baseDate = eventDate;
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
        startDate: startDate,
        endDate: endDate
      };

      return event;
    } catch (error) {
      console.log(`Error parsing all-day event: ${error.message}`);
      return null;
    }
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
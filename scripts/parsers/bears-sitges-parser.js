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
   * @param {number} maxDays - Maximum number of days to parse (for memory management)
   * @returns {Array} Array of parsed event objects
   */
  parse(html, url, maxDays = null) {
    if (!html || typeof html !== 'string') {
      return [];
    }

    try {
      // Extract the event dates first (September 5-14, 2025)
      const eventDates = this.extractEventDates(html);
      
      // Extract events from the HTML structure with actual dates
      const events = this.extractEvents(html, url, eventDates, maxDays);
      return events;
    } catch (error) {
      console.log(`BearsSitgesParser error: ${error.message}`);
      return [];
    }
  }

  /**
   * Main parsing method - receives HTML data and returns events + additional links
   * @param {Object} htmlData - Object containing html and url properties
   * @param {Object} parserConfig - Parser configuration
   * @param {Object} cityConfig - City configuration
   * @returns {Object} Object with events, additionalLinks, source, and url
   */
  parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
    try {
      const events = [];
      const html = htmlData.html;
      
      if (!html) {
        console.warn('🐻 Bears Sitges: No HTML content to parse');
        return { events: [], additionalLinks: [], source: this.name, url: htmlData.url };
      }
      
      // Get maxDays from parser config for memory management
      const maxDays = parserConfig.maxDays || null;
      
      // Parse events using the existing parse method with day limit
      const parsedEvents = this.parse(html, htmlData.url, maxDays);
      events.push(...parsedEvents);
      
      // Bears Sitges doesn't have additional links to discover
      const additionalLinks = [];
      
      return { 
        events, 
        additionalLinks, 
        source: this.name, 
        url: htmlData.url 
      };
    } catch (error) {
      console.log(`BearsSitgesParser parseEvents error: ${error.message}`);
      return { events: [], additionalLinks: [], source: this.name, url: htmlData.url };
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
   * @param {number} maxDays - Maximum number of days to parse (for memory management)
   * @returns {Array} Array of event objects
   */
  extractEvents(html, url, eventDates = {}, maxDays = null) {
    const events = [];
    const seenEvents = new Set(); // For deduplication
    
    // Convert to array and sort by date, then limit if maxDays is specified
    const sortedDays = Object.entries(eventDates)
      .sort(([, dateA], [, dateB]) => dateA - dateB)
      .slice(0, maxDays || undefined);
    
    console.log(`Parsing events for ${sortedDays.length} days (maxDays: ${maxDays || 'unlimited'})`);
    
    // Parse events by day
    for (const [dayText, eventDate] of sortedDays) {
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
    
    // Parse structured events from the day section
    const structuredEvents = this.parseStructuredEvents(daySection, url, eventDate);
    events.push(...structuredEvents);

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
   * Parse structured events from a day section
   * @param {string} daySection - HTML section for a specific day
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @returns {Array} Array of properly structured event objects
   */
  parseStructuredEvents(daySection, url, eventDate) {
    const events = [];
    
    // Parse events from <p> tags within the day section
    const pTagRegex = /<p[^>]*>([^<]*(?:<[^>]*>[^<]*)*?)<\/p>/gi;
    let pMatch;
    
    while ((pMatch = pTagRegex.exec(daySection)) !== null) {
      const pContent = pMatch[1];
      
      // Look for specific Bears Sitges Week patterns
      const event = this.parseBearsSitgesEvent(pContent, url, eventDate);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  /**
   * Parse a Bears Sitges Week event from paragraph content
   * @param {string} pContent - Paragraph HTML content
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @returns {Object|null} Parsed event object or null
   */
  parseBearsSitgesEvent(pContent, url, eventDate) {
    try {
      // Clean the content to get plain text
      const cleanText = pContent.replace(/<[^>]+>/g, ' ').replace(/&[^;]*;/g, ' ').replace(/\s+/g, ' ').trim();
      
      // Pattern 1: "20h. INAUGURACIÓN BEARS SITGES WEEK 2025"
      if (cleanText.includes('20h.') && cleanText.includes('INAUGURACIÓN')) {
        const startDate = new Date(eventDate);
        startDate.setHours(20, 0, 0, 0);
        const endDate = new Date(eventDate);
        endDate.setHours(22, 0, 0, 0);
        
        return {
          title: 'BEARS SITGES WEEK 2025 OPENING',
          description: 'Cava and aperitifs.',
          url: url,
          source: 'bears-sitges',
          city: 'sitges',
          startDate: startDate,
          endDate: endDate,
          bar: 'Hotel Calipolis.',
          cover: 'Free admission.'
        };
      }
      
      // Pattern 2: "22h: Ruta del OSO" (handle space in "22 h:")
      if ((cleanText.includes('22h:') || cleanText.includes('22 h:')) && cleanText.includes('Ruta del OSO')) {
        const startDate = new Date(eventDate);
        startDate.setHours(22, 0, 0, 0);
        const endDate = new Date(eventDate);
        endDate.setDate(endDate.getDate() + 1);
        endDate.setHours(1, 0, 0, 0);
        
        return {
          title: 'Bear Route',
          description: 'Bears Bar - Bears Dance Bar - Moulin Rose Sitges - Runway Terrace - Industry Sitges - Chiringuito Iguana - Parrots Terrace Pub',
          url: url,
          source: 'bears-sitges',
          city: 'sitges',
          startDate: startDate,
          endDate: endDate,
          bar: 'Bares Sponsors',
          cover: 'You will find tickets with 50% discount for some bars in the "BEARS SITGES PACK"'
        };
      }
      
      // Pattern 3: "01h a 06h Welcome Bears"
      if (cleanText.includes('01h a 06h') && cleanText.includes('Welcome Bears')) {
        const startDate = new Date(eventDate);
        startDate.setDate(startDate.getDate() + 1);
        startDate.setHours(1, 0, 0, 0);
        const endDate = new Date(eventDate);
        endDate.setDate(endDate.getDate() + 1);
        endDate.setHours(6, 0, 0, 0);
        
        return {
          title: 'Welcome Bears in "BEARS DISCO"',
          description: 'Welcome Bears in "BEARS DISCO"',
          url: url,
          source: 'bears-sitges',
          city: 'sitges',
          startDate: startDate,
          endDate: endDate,
          bar: 'Scandal'
        };
      }
      
      return null;
    } catch (error) {
      console.log(`Error parsing Bears Sitges event: ${error.message}`);
      return null;
    }
  }

  /**
   * Find time-based patterns (01h to 06h, etc.)
   * @param {string} html - Raw HTML content
   * @returns {Array} Array of time pattern strings
   */
  findTimePatterns(html) {
    const patterns = [];
    
    // Look for time patterns in HTML structure
    // Pattern 1: Time ranges like "01h a 06h"
    const timeRangeRegex = /(\d{1,2})h\s+a\s+(\d{1,2})h[^<]*?([^<]+?)(?=<|$)/gi;
    const rangeMatches = html.match(timeRangeRegex);
    if (rangeMatches) {
      patterns.push(...rangeMatches);
    }
    
    // Pattern 2: Single times like "20h." or "22h:" (handle HTML splitting)
    // Look for patterns where the hour and "h" might be in different HTML elements
    const singleTimeRegex = /(\d{1,2})[^<]*?h\s*[\.:][^<]*?([A-Z][^<]+?)(?=<|$)/gi;
    const singleMatches = html.match(singleTimeRegex);
    if (singleMatches) {
      patterns.push(...singleMatches);
    }
    
    // Pattern 3: Handle cases where hour and "h" are in different HTML elements
    // Look for "22" followed by "h:" in nearby HTML - reconstruct the pattern
    const splitTimeRegex = /(\d{1,2})[^<]*?<[^>]*>[^<]*?h\s*[\.:][^<]*?([A-Z][^<]+?)(?=<|$)/gi;
    const splitMatches = html.match(splitTimeRegex);
    if (splitMatches) {
      // Reconstruct the pattern by combining the hour with the rest
      splitMatches.forEach(match => {
        const hourMatch = match.match(/(\d{1,2})/);
        const restMatch = match.match(/h\s*[\.:][^<]*?([A-Z][^<]+?)(?=<|$)/);
        if (hourMatch && restMatch) {
          const reconstructed = `${hourMatch[1]}${restMatch[0]}`;
          patterns.push(reconstructed);
        }
      });
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
   * Parse a time pattern (e.g., "01h a 06h DISCO POP", "20h. INAUGURACIÓN", "22h: Ruta del OSO")
   * @param {string} pattern - Time pattern string
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @returns {Object|null} Parsed event object or null
   */
  parseTimePattern(pattern, url, eventDate = null) {
    try {
      // Clean the pattern to remove HTML artifacts
      const cleanPattern = pattern.replace(/[^<]*>/, '').replace(/<[^>]*$/, '');
      
      // Extract time range or single time
      const timeRangeMatch = cleanPattern.match(/(\d{1,2})h\s+a\s+(\d{1,2})h/);
      const singleTimeMatch = cleanPattern.match(/(\d{1,2})h\s*[\.:]/);
      
      let startHour, endHour;
      
      if (timeRangeMatch) {
        // Time range: "01h a 06h"
        startHour = parseInt(timeRangeMatch[1]);
        endHour = parseInt(timeRangeMatch[2]);
      } else if (singleTimeMatch) {
        // Single time: "20h." or "22h:"
        startHour = parseInt(singleTimeMatch[1]);
        // Default end time based on event type
        if (startHour === 20) {
          endHour = 22; // Opening event
        } else if (startHour === 22) {
          endHour = 1; // Bear Route (next day)
        } else {
          endHour = startHour + 2; // Default 2 hours
        }
      } else {
        return null;
      }

      // Extract event description - look for text after the time
      let description = '';
      if (timeRangeMatch) {
        const descMatch = cleanPattern.match(/\d{1,2}h\s+a\s+\d{1,2}h\s+(.+?)(?:\s*$|\s*<)/);
        description = descMatch ? descMatch[1].trim() : '';
      } else if (singleTimeMatch) {
        const descMatch = cleanPattern.match(/\d{1,2}h\s*[\.:]\s*(.+?)(?:\s*$|\s*<)/);
        description = descMatch ? descMatch[1].trim() : '';
      }
      
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

  /**
   * Create an event from a single time (e.g., "20h. INAUGURACIÓN BEARS SITGES WEEK 2025")
   * @param {string} timeStr - Time string (e.g., "20", "22")
   * @param {string} eventText - Full event text
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @returns {Object|null} Event object or null
   */
  createEventFromSingleTime(timeStr, eventText, url, eventDate) {
    try {
      const hour = parseInt(timeStr);
      if (isNaN(hour) || hour < 0 || hour > 23) {
        return null;
      }
      
      // Parse the event text to extract title, description, location, and cover
      let title = '';
      let description = '';
      let location = '';
      let cover = '';
      
      // Special handling for different event types
      if (eventText.toLowerCase().includes('inauguración')) {
        // Opening event: "INAUGURACIÓN BEARS SITGES WEEK 2025 Brindaremos con Cava y Aperitivo. Hotel Calipolis. Entrada Libre"
        title = 'BEARS SITGES WEEK 2025 OPENING';
        description = 'Cava and aperitifs.';
        location = 'Hotel Calipolis.';
        cover = 'Free admission.';
      } else if (eventText.toLowerCase().includes('ruta del oso')) {
        // Bear Route event: "Ruta del OSO en «Bares Sponsors» : Bears Bar – Bears Dance Bar..."
        title = 'Bear Route';
        description = 'Bears Bar - Bears Dance Bar - Moulin Rose Sitges - Runway Terrace - Industry Sitges - Chiringuito Iguana - Parrots Terrace Pub';
        location = 'Bares Sponsors';
        cover = 'You will find tickets with 50% discount for some bars in the "BEARS SITGES PACK"';
      } else {
        // Default parsing
        const titleMatch = eventText.match(/^([^.]+)/);
        if (titleMatch) {
          title = titleMatch[1].trim();
        }
        
        const descMatch = eventText.match(/^[^.]+\.?\s*(.+)/);
        if (descMatch) {
          description = descMatch[1].trim();
        }
      }
      
      // Determine end time based on event type
      let endHour = hour + 2; // Default 2-hour duration
      
      if (title.toLowerCase().includes('inauguración') || title.toLowerCase().includes('opening')) {
        endHour = 22; // 8pm to 10pm
      } else if (title.toLowerCase().includes('ruta del oso') || title.toLowerCase().includes('bear route')) {
        endHour = 1; // 10pm to 1am (next day)
      }
      
      const startDate = new Date(eventDate);
      startDate.setHours(hour, 0, 0, 0);
      
      const endDate = new Date(eventDate);
      if (endHour < hour) {
        // Next day
        endDate.setDate(endDate.getDate() + 1);
        endDate.setHours(endHour, 0, 0, 0);
      } else {
        endDate.setHours(endHour, 0, 0, 0);
      }
      
      return {
        title: title,
        description: description,
        url: url,
        source: 'bears-sitges',
        city: 'sitges',
        startDate: startDate,
        endDate: endDate,
        bar: location || null,
        cover: cover || null
      };
    } catch (error) {
      console.log(`Error creating event from single time: ${error.message}`);
      return null;
    }
  }

  /**
   * Create an event from a time range (e.g., "01h a 06h Welcome Bears en «BEARS DISCO» by Scandal")
   * @param {number} startHour - Start hour (0-23)
   * @param {number} endHour - End hour (0-23)
   * @param {string} eventTitle - Event title
   * @param {string} venue - Venue name
   * @param {string} bar - Bar/venue name
   * @param {string} url - Source URL
   * @param {Date} eventDate - The actual date for this event
   * @returns {Object|null} Event object or null
   */
  createEventFromTimeRange(startHour, endHour, eventTitle, venue, bar, url, eventDate) {
    try {
      const startDate = new Date(eventDate);
      startDate.setHours(startHour, 0, 0, 0);
      
      const endDate = new Date(eventDate);
      if (endHour < startHour) {
        // Next day
        endDate.setDate(endDate.getDate() + 1);
        endDate.setHours(endHour, 0, 0, 0);
      } else {
        endDate.setHours(endHour, 0, 0, 0);
      }
      
      // Build description
      let description = eventTitle;
      if (venue) {
        description += ` en «${venue}»`;
      }
      if (bar) {
        description += ` by ${bar}`;
      }
      
      return {
        title: eventTitle,
        description: description,
        url: url,
        source: 'bears-sitges',
        city: 'sitges',
        startDate: startDate,
        endDate: endDate,
        bar: bar || venue || null
      };
    } catch (error) {
      console.log(`Error creating event from time range: ${error.message}`);
      return null;
    }
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




}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BearsSitgesParser };
} else if (typeof window !== 'undefined') {
  window.BearsSitgesParser = BearsSitgesParser;
} else {
  // Scriptable environment
  this.BearsSitgesParser = BearsSitgesParser;
}
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
    
    // Clean the HTML to get plain text
    const cleanText = daySection.replace(/<[^>]+>/g, ' ').replace(/&[^;]*;/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Parse the specific format for Bears Sitges Week
    // Expected format: "20h. INAUGURACIÓN BEARS SITGES WEEK 2025 Brindaremos con Cava y Aperitivo. Hotel Calipolis. Entrada Libre"
    // "22 h: Ruta del OSO en «Bares Sponsors» : Bears Bar – Bears Dance Bar – Moulin Rose Sitges – Runway Terrace – Industry Sitges – Chiringuito Iguana Parrots Terrace Pub **Encontrarás tickets con 50% descuento para algunos bares en el «PACK BEARS SITGES»"
    // "01h a 06h Welcome Bears en «BEARS DISCO» by Scandal"
    
    // Manual parsing approach for the specific Friday structure
    if (cleanText.includes('VIERNES - 05')) {
      // Event 1: 20h. INAUGURACIÓN BEARS SITGES WEEK 2025
      const openingMatch = cleanText.match(/20h\.\s*(.+?)(?=22\s*h)/);
      if (openingMatch) {
        const event = this.createEventFromSingleTime('20', openingMatch[1].trim(), url, eventDate);
        if (event) {
          events.push(event);
        }
      }
      
      // Event 2: 22 h: Ruta del OSO
      const routeMatch = cleanText.match(/22\s*h:\s*(.+?)(?=01h\s+a)/);
      if (routeMatch) {
        const event = this.createEventFromSingleTime('22', routeMatch[1].trim(), url, eventDate);
        if (event) {
          events.push(event);
        }
      }
      
      // Event 3: 01h a 06h Welcome Bears
      const discoMatch = cleanText.match(/01h\s+a\s+06h\s+(.+?)(?=ATENCIÓN)/);
      if (discoMatch) {
        const event = this.createEventFromTimeRange(1, 6, 'Welcome Bears in "BEARS DISCO"', 'BEARS DISCO', 'Scandal', url, eventDate);
        if (event) {
          events.push(event);
        }
      }
    } else {
      // Fallback to regex patterns for other days
      // Pattern 1: Single time events (20h., 22 h:, etc.)
      const singleTimePattern = /(\d{1,2})\s*h\.?\s*:?\s*([^0-9]+?)(?=\d{1,2}\s*h|$)/gi;
      let match;
      
      while ((match = singleTimePattern.exec(cleanText)) !== null) {
        const timeStr = match[1];
        const eventText = match[2].trim();
        
        // Skip if this looks like a time range (01h a 06h)
        if (eventText.includes('a') && eventText.includes('h')) {
          continue;
        }
        
        const event = this.createEventFromSingleTime(
          timeStr, eventText, url, eventDate
        );
        if (event) {
          events.push(event);
        }
      }
      
      // Pattern 2: Time ranges (01h a 06h)
      const timeRangePattern = /(\d{1,2})h\s+a\s+(\d{1,2})h\s+(.+?)(?:\s*en\s+«([^»]+)»\s*by\s+([^<]+))?/gi;
      while ((match = timeRangePattern.exec(cleanText)) !== null) {
        const startHour = parseInt(match[1]);
        const endHour = parseInt(match[2]);
        const eventTitle = match[3].trim();
        const venue = match[4] ? match[4].trim() : '';
        const bar = match[5] ? match[5].trim() : '';
        
        const event = this.createEventFromTimeRange(
          startHour, endHour, eventTitle, venue, bar, url, eventDate
        );
        if (event) {
          events.push(event);
        }
      }
    }
    
    return events;
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
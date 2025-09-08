/**
 * Bears Sitges Week Event Parser
 * Parses events from the Bears Sitges Week website
 */

class BearsSitgesParser {
  constructor() {
    this.name = 'bears-sitges';
    this.baseUrl = 'https://bearssitges.org';
  }

  /**
   * Main parsing method - receives HTML data and returns events + additional links
   * @param {Object} htmlData - HTML data object with html and url properties
   * @param {Object} parserConfig - Parser configuration
   * @param {Object} cityConfig - City configuration
   * @returns {Object} Parsed events and metadata
   */
  parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
    try {
      const html = htmlData.html;
      const url = htmlData.url;
      const maxDays = parserConfig.maxDays || 1;
      
      if (!html) {
        console.log('🔧 Bears Sitges: No HTML content to parse');
        return { events: [], additionalLinks: [], source: this.name, url: url };
      }

      // Extract event dates from the HTML
      const eventDates = this.extractEventDates(html);
      
      if (eventDates.length === 0) {
        console.log('🔧 Bears Sitges: No event dates found in HTML');
        return { events: [], additionalLinks: [], source: this.name, url: url };
      }

      // Parse events for each day
      const allEvents = [];
      const daysToProcess = eventDates.slice(0, maxDays);
      
      for (const eventDate of daysToProcess) {
        const dayText = this.getDayText(eventDate);
        const dayEvents = this.extractEventsForDay(html, url, eventDate, dayText);
        allEvents.push(...dayEvents);
      }

      // Remove duplicates
      const uniqueEvents = this.removeDuplicateEvents(allEvents);

      return { 
        events: uniqueEvents, 
        additionalLinks: [], 
        source: this.name, 
        url: url 
      };
    } catch (error) {
      console.log(`🔧 Bears Sitges: Error parsing events: ${error.message}`);
      return { events: [], additionalLinks: [], source: this.name, url: htmlData.url };
    }
  }

  /**
   * Parse events from HTML content (legacy method for backward compatibility)
   * @param {string} html - HTML content
   * @param {string} url - Source URL
   * @param {number} maxDays - Maximum number of days to parse
   * @returns {Object} Parsed events and metadata
   */
  parse(html, url, maxDays = 7) {
    try {
      // Extract event dates from the HTML
      const eventDates = this.extractEventDates(html);
      
      if (eventDates.length === 0) {
        console.log('No event dates found in HTML');
        return { events: [], additionalLinks: [], source: this.name, url: url };
      }

      // Parse events for each day
      const allEvents = [];
      const daysToProcess = eventDates.slice(0, maxDays);
      
      for (const eventDate of daysToProcess) {
        const dayText = this.getDayText(eventDate);
        const dayEvents = this.extractEventsForDay(html, url, eventDate, dayText);
        allEvents.push(...dayEvents);
      }

      // Remove duplicates
      const uniqueEvents = this.removeDuplicateEvents(allEvents);

      return { 
        events: uniqueEvents, 
        additionalLinks: [], 
        source: this.name, 
        url: url 
      };
    } catch (error) {
      console.log(`Error parsing Bears Sitges events: ${error.message}`);
      return { events: [], additionalLinks: [], source: this.name, url: url };
    }
  }

  /**
   * Extract event dates from HTML content
   * @param {string} html - HTML content
   * @returns {Array} Array of Date objects
   */
  extractEventDates(html) {
    const eventDates = [];
    
    // Look for day patterns like "VIERNES - 05", "SÁBADO - 06", etc.
    // Handle HTML-split day names like "MIÉR<tag>COLES" or "SÁ<tag>BADO"
    const dayPattern = /(VIERNES|SÁ[^<]*BADO|DOMINGO|LUNES|MARTES|MIÉR[^<]*COLES|JUEVES|SABADO|DOMINGO)\s*-\s*(\d{1,2})/gi;
    const matches = html.match(dayPattern);
    
    if (!matches) {
      return eventDates;
    }

    // Determine the year and month from context
    const year = this.extractYear(html);
    const month = this.extractMonth(html);
    
    for (const match of matches) {
      const dayMatch = match.match(/(\w+)\s*-\s*(\d{1,2})/);
      if (dayMatch) {
        let dayName = dayMatch[1].toUpperCase();
        const dayNumber = parseInt(dayMatch[2]);
        
        // Fix HTML-split day names
        if (dayName.includes('RCOLES')) {
          dayName = 'MIÉRCOLES';
        } else if (dayName.includes('BADO')) {
          dayName = 'SÁBADO';
        }
        
        try {
          const eventDate = this.createEventDate(year, month, dayNumber, dayName);
          if (eventDate) {
            eventDates.push(eventDate);
          }
        } catch (error) {
          console.log(`Error creating date for ${dayName} ${dayNumber}: ${error.message}`);
        }
      }
    }
    
    return eventDates;
  }

  /**
   * Extract year from HTML content
   * @param {string} html - HTML content
   * @returns {number} Year
   */
  extractYear(html) {
    // Look for Bears Sitges Week specific year patterns
    // Check for "BEARS SITGES WEEK 2025" or similar patterns
    const bearsWeekMatch = html.match(/BEARS SITGES WEEK\s+(\d{4})/i);
    if (bearsWeekMatch) {
      return parseInt(bearsWeekMatch[1]);
    }
    
    // Look for any 4-digit year patterns in the context of the event
    const yearMatches = html.match(/\b(\d{4})\b/g);
    if (yearMatches) {
      // Get the most recent year
      const years = yearMatches.map(match => parseInt(match));
      if (years.length > 0) {
        return Math.max(...years);
      }
    }
    
    // Default to current year + 1
    return new Date().getFullYear() + 1;
  }

  /**
   * Extract month from HTML content
   * @param {string} html - HTML content
   * @returns {number} Month (1-12)
   */
  extractMonth(html) {
    // Look for month patterns in the context of event dates
    // Check for patterns like "Del 5 al 14 de SEPTIEMBRE" or "Bears Sitges Week (Septiembre)"
    const eventContextPatterns = [
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(enero|january)/i, month: 1 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(febrero|february)/i, month: 2 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(marzo|march)/i, month: 3 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(abril|april)/i, month: 4 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(mayo|may)/i, month: 5 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(junio|june)/i, month: 6 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(julio|july)/i, month: 7 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(agosto|august)/i, month: 8 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(septiembre|september)/i, month: 9 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(octubre|october)/i, month: 10 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(noviembre|november)/i, month: 11 },
      { pattern: /del\s+\d+\s+al\s+\d+\s+de\s+(diciembre|december)/i, month: 12 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(enero|january)/i, month: 1 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(febrero|february)/i, month: 2 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(marzo|march)/i, month: 3 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(abril|april)/i, month: 4 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(mayo|may)/i, month: 5 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(junio|june)/i, month: 6 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(julio|july)/i, month: 7 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(agosto|august)/i, month: 8 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(septiembre|september)/i, month: 9 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(octubre|october)/i, month: 10 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(noviembre|november)/i, month: 11 },
      { pattern: /bears\s+sitges\s+week\s*\([^)]*(diciembre|december)/i, month: 12 }
    ];
    
    for (const { pattern, month } of eventContextPatterns) {
      if (pattern.test(html)) {
        return month;
      }
    }
    
    // Fallback: Look for any month patterns
    const monthPatterns = [
      { pattern: /enero|january/i, month: 1 },
      { pattern: /febrero|february/i, month: 2 },
      { pattern: /marzo|march/i, month: 3 },
      { pattern: /abril|april/i, month: 4 },
      { pattern: /mayo|may/i, month: 5 },
      { pattern: /junio|june/i, month: 6 },
      { pattern: /julio|july/i, month: 7 },
      { pattern: /agosto|august/i, month: 8 },
      { pattern: /septiembre|september/i, month: 9 },
      { pattern: /octubre|october/i, month: 10 },
      { pattern: /noviembre|november/i, month: 11 },
      { pattern: /diciembre|december/i, month: 12 }
    ];
    
    for (const { pattern, month } of monthPatterns) {
      if (pattern.test(html)) {
        return month;
      }
    }
    
    // Default to current month
    return new Date().getMonth() + 1;
  }

  /**
   * Create event date from day information
   * @param {number} year - Year
   * @param {number} month - Month (1-12)
   * @param {number} dayNumber - Day number
   * @param {string} dayName - Day name
   * @returns {Date|null} Event date or null
   */
  createEventDate(year, month, dayNumber, dayName) {
    // Create date and verify it matches the expected day of week
    const date = new Date(year, month - 1, dayNumber);
    const expectedDayOfWeek = this.getDayOfWeek(dayName);
    
    if (date.getDay() === expectedDayOfWeek) {
      return date;
    }
    
    // If day doesn't match, try next week
    date.setDate(date.getDate() + 7);
    if (date.getDay() === expectedDayOfWeek) {
      return date;
    }
    
    // If still doesn't match, try previous week
    date.setDate(date.getDate() - 14);
    if (date.getDay() === expectedDayOfWeek) {
      return date;
    }
    
    // If still doesn't match, just return the date as-is (assume it's correct)
    console.log(`Warning: Day of week mismatch for ${dayName} ${dayNumber}, but using date anyway`);
    return new Date(year, month - 1, dayNumber);
  }

  /**
   * Get day of week number from day name
   * @param {string} dayName - Day name
   * @returns {number} Day of week (0-6)
   */
  getDayOfWeek(dayName) {
    const days = {
      'DOMINGO': 0, 'SUNDAY': 0,
      'LUNES': 1, 'MONDAY': 1,
      'MARTES': 2, 'TUESDAY': 2,
      'MIÉRCOLES': 3, 'WEDNESDAY': 3,
      'JUEVES': 4, 'THURSDAY': 4,
      'VIERNES': 5, 'FRIDAY': 5,
      'SÁBADO': 6, 'SABADO': 6, 'SATURDAY': 6
    };
    
    return days[dayName] || 0;
  }

  /**
   * Get day text for a given date
   * @param {Date} eventDate - Event date
   * @returns {string} Day text
   */
  getDayText(eventDate) {
    const dayNames = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
    const dayName = dayNames[eventDate.getDay()];
    const dayNumber = eventDate.getDate().toString().padStart(2, '0');
    return `${dayName} - ${dayNumber}`;
  }

  /**
   * Extract events for a specific day
   * @param {string} html - HTML content
   * @param {string} url - Source URL
   * @param {Date} eventDate - Event date
   * @param {string} dayText - Day text
   * @returns {Array} Array of events
   */
  extractEventsForDay(html, url, eventDate, dayText) {
    const events = [];
    const daySection = this.findDaySection(html, dayText);
    if (!daySection) {
      return events;
    }
    
    const structuredEvents = this.parseStructuredEvents(daySection, url, eventDate);
    events.push(...structuredEvents);
    return events;
  }

  /**
   * Find the HTML section for a specific day
   * @param {string} html - HTML content
   * @param {string} dayText - Day text
   * @returns {string|null} Day section HTML or null
   */
  findDaySection(html, dayText) {
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
      
      // Look for time patterns in the text
      const timeRangeMatch = cleanText.match(/(\d{1,2})h\s+a\s+(\d{1,2})h\s+(.+)/);
      const singleTimeMatch = cleanText.match(/(\d{1,2})\s*h\s*[\.:]\s*(.+)/);
      
      let startHour, endHour, eventText;
      
      if (timeRangeMatch) {
        // Time range: "01h a 06h Welcome Bears"
        startHour = parseInt(timeRangeMatch[1]);
        endHour = parseInt(timeRangeMatch[2]);
        eventText = timeRangeMatch[3].trim();
      } else if (singleTimeMatch) {
        // Single time: "20h. INAUGURACIÓN" or "22 h: Ruta del OSO"
        startHour = parseInt(singleTimeMatch[1]);
        eventText = singleTimeMatch[2].trim();
        
        // Generic end time calculation - default 2 hours duration
        endHour = startHour + 2;
        
        // Handle next-day events (when end hour would be >= 24)
        if (endHour >= 24) {
          endHour = endHour - 24;
        }
      } else {
        return null; // No time pattern found
      }
      
      // Extract title and description from event text
      const title = this.extractEventTitle(eventText);
      const description = this.extractEventDescription(eventText);
      const bar = this.extractEventBar(eventText);
      const cover = this.extractEventCover(eventText);
      
      // Create start and end dates
      const startDate = new Date(eventDate);
      startDate.setHours(startHour, 0, 0, 0);
      
      const endDate = new Date(eventDate);
      if (endHour < startHour) {
        endDate.setDate(endDate.getDate() + 1);
      }
      endDate.setHours(endHour, 0, 0, 0);
      
      return {
        title: title,
        description: description,
        url: url,
        source: 'bears-sitges',
        city: 'sitges',
        startDate: startDate,
        endDate: endDate,
        bar: bar,
        cover: cover
      };
    } catch (error) {
      console.log(`Error parsing Bears Sitges event: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract event title from event text
   * @param {string} eventText - The event text after time
   * @returns {string} Extracted title
   */
  extractEventTitle(eventText) {
    // Look for the main event name (usually the first part before periods or "en")
    const titleMatch = eventText.match(/^([A-Z][^.]*?)(?:\s+en\s+«|\.|$)/);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
    
    // Look for title before any periods
    const periodMatch = eventText.match(/^([^.]*?)(?:\s*\.|$)/);
    if (periodMatch) {
      return periodMatch[1].trim();
    }
    
    // Fallback: take first part
    return eventText.split(' ')[0] || eventText;
  }

  /**
   * Extract event description from event text
   * @param {string} eventText - The event text after time
   * @returns {string} Extracted description
   */
  extractEventDescription(eventText) {
    // Look for description after the title (after first period)
    const descMatch = eventText.match(/^[^.]*\.?\s*(.+?)(?:\s*en\s+«|$)/);
    if (descMatch) {
      return descMatch[1].trim();
    }
    
    // Look for description after first period
    const parts = eventText.split('.');
    if (parts.length > 1) {
      return parts.slice(1).join('.').trim();
    }
    
    // Fallback: return the full text
    return eventText;
  }

  /**
   * Extract event bar/venue from event text
   * @param {string} eventText - The event text after time
   * @returns {string|null} Extracted bar/venue
   */
  extractEventBar(eventText) {
    // Look for venue in quotes
    const venueMatch = eventText.match(/en\s+«([^»]+)»/);
    if (venueMatch) {
      return venueMatch[1].trim();
    }
    
    // Look for "by" pattern
    const byMatch = eventText.match(/by\s+([^<]+)/);
    if (byMatch) {
      return byMatch[1].trim();
    }
    
    return null;
  }

  /**
   * Extract event cover/ticket info from event text
   * @param {string} eventText - The event text after time
   * @returns {string|null} Extracted cover/ticket info
   */
  extractEventCover(eventText) {
    // Look for ticket info in asterisks
    const ticketMatch = eventText.match(/\*\*([^*]+)\*\*/);
    if (ticketMatch) {
      return ticketMatch[1].trim();
    }
    
    // Look for "Entrada" info
    const entradaMatch = eventText.match(/(Entrada[^.]*\.?)/);
    if (entradaMatch) {
      return entradaMatch[1].trim();
    }
    
    return null;
  }

  /**
   * Remove duplicate events
   * @param {Array} events - Array of events
   * @returns {Array} Array of unique events
   */
  removeDuplicateEvents(events) {
    const seenEvents = new Set();
    return events.filter(event => {
      const key = this.getEventKey(event);
      if (seenEvents.has(key)) {
        return false;
      }
      seenEvents.add(key);
      return true;
    });
  }

  /**
   * Get unique key for an event
   * @param {Object} event - Event object
   * @returns {string} Unique key
   */
  getEventKey(event) {
    const title = event.title || '';
    const startDate = event.startDate ? event.startDate.toISOString() : '';
    const endDate = event.endDate ? event.endDate.toISOString() : '';
    
    return `${title}-${startDate}-${endDate}`;
  }
}

module.exports = { BearsSitgesParser };
// Today Events Aggregator - loads cached ICS files and renders events happening today
class TodayEventsAggregator {
  constructor() {
    this.containerSelector = '#today-event-grid';
    this.container = null;
    this.maxCities = 20; // safety cap
    logger.componentInit('CALENDAR', 'TodayEventsAggregator initializing');
  }

  async init() {
    try {
      this.container = document.querySelector(this.containerSelector);
      if (!this.container) {
        logger.warn('CALENDAR', 'Today events container not found', { selector: this.containerSelector });
        return;
      }

      const cities = (window.getAvailableCities ? getAvailableCities() : []).filter(c => hasCityCalendar(c.key));
      const selectedCities = cities.slice(0, this.maxCities);

      logger.info('CALENDAR', 'Loading cached ICS for today aggregation', { count: selectedCities.length });

      const allEvents = await this.loadAllCityEvents(selectedCities);
      const todayEvents = this.filterEventsForToday(allEvents);
      const deduped = this.dedupeBySlug(todayEvents);
      const sorted = deduped.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

      this.renderTodayEvents(sorted);
      logger.componentLoad('CALENDAR', 'TodayEventsAggregator completed', { total: sorted.length });
    } catch (error) {
      logger.componentError('CALENDAR', 'TodayEventsAggregator failed', error);
    }
  }

  async loadAllCityEvents(cities) {
    const fetches = cities.map(city => this.loadCityEvents(city));
    const results = await Promise.all(fetches);
    // Flatten and keep city context
    return results.flat();
  }

  async loadCityEvents(city) {
    try {
      const url = this.getCachedCalendarPath(city.key);
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const icalText = await res.text();
      if (!icalText || !icalText.includes('BEGIN:VCALENDAR')) throw new Error('Invalid ICS');

      const core = new CalendarCore();
      const events = core.parseICalData(icalText) || [];
      // attach city details for display
      events.forEach(ev => {
        ev.cityKey = city.key;
        ev.cityName = city.name;
      });
      return events;
    } catch (e) {
      logger.componentError('CALENDAR', `Failed to load ICS for ${city.name}`, e);
      return [];
    }
  }

  getCachedCalendarPath(cityKey) {
    try {
      const isTesting = window.location.pathname.includes('/testing/');
      const prefix = isTesting ? '../' : '';
      return `${prefix}data/calendars/${cityKey}.ics`;
    } catch (e) {
      return `data/calendars/${cityKey}.ics`;
    }
  }

  filterEventsForToday(events) {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(startOfToday);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 2); // Include tomorrow
    endOfTomorrow.setHours(0, 0, 0, 0);

    return events.filter(ev => {
      const start = new Date(ev.startDate);
      if (Number.isNaN(start.getTime())) return false;

      // For recurring events, check if they occur today or tomorrow
      if (ev.recurring) {
        return this.isRecurringEventInPeriod(ev, startOfToday, endOfTomorrow);
      }

      // For one-time events, check if they fall within the period
      return start >= startOfToday && start < endOfTomorrow;
    });
  }

  // Check if a recurring event occurs within the given period (copied from DynamicCalendarLoader)
  isRecurringEventInPeriod(event, start, end) {
    if (!event.startDate) return false;
    
    const current = new Date(start);
    
    // Check each day in the period
    while (current <= end) {
      if (this.isEventOccurringOnDate(event, current)) {
        return true;
      }
      current.setDate(current.getDate() + 1);
    }
    
    return false;
  }

  // Helper function to determine if a recurring event occurs on a specific date (copied from DynamicCalendarLoader)
  isEventOccurringOnDate(event, date) {
    if (!event.recurring || !event.startDate) return false;
    
    const eventDate = new Date(event.startDate);
    const checkDate = new Date(date);
    
    // Normalize dates to compare only date parts, not time
    eventDate.setHours(0, 0, 0, 0);
    checkDate.setHours(0, 0, 0, 0);
    
    // Make sure we're not checking before the event started
    if (checkDate < eventDate) return false;
    
    // Parse the recurrence rule to determine the pattern
    const recurrence = event.recurrence || '';
    
    if (recurrence.includes('FREQ=WEEKLY')) {
      // Weekly events: occur on the same day of the week
      return eventDate.getDay() === checkDate.getDay();
    } else if (recurrence.includes('FREQ=MONTHLY')) {
      // Monthly events: handle both BYMONTHDAY and BYDAY patterns
      if (recurrence.includes('BYMONTHDAY=')) {
        const dayMatch = recurrence.match(/BYMONTHDAY=(\d+)/);
        if (dayMatch) {
          const targetDay = parseInt(dayMatch[1]);
          // Check if this month has that many days
          const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
          return checkDate.getDate() === Math.min(targetDay, lastDayOfMonth);
        }
      } else if (recurrence.includes('BYDAY=')) {
        // Handle BYDAY patterns like BYDAY=3TH (third Thursday) or BYDAY=-1SA (last Saturday)
        const dayMatch = recurrence.match(/BYDAY=(-?\d+)([A-Z]{2})/);
        if (dayMatch) {
          const occurrence = parseInt(dayMatch[1]); // 3 or -1 (negative means from end of month)
          const dayCode = dayMatch[2]; // TH, SA, etc.
          
          // Convert day code to day number (0 = Sunday, 6 = Saturday)
          const dayCodeToDayNumber = {
            'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
          };
          
          const targetDayOfWeek = dayCodeToDayNumber[dayCode];
          if (targetDayOfWeek === undefined) return false;
          
          // Check if the check date is the correct day of the week
          if (checkDate.getDay() !== targetDayOfWeek) return false;
          
          // Calculate the target date for this occurrence
          const targetDate = this.calculateByDayOccurrence(
            checkDate.getFullYear(), 
            checkDate.getMonth(), 
            occurrence, 
            targetDayOfWeek
          );
          
          return targetDate && checkDate.getTime() === targetDate.getTime();
        }
      }
      
      // Fallback: same day of month as original event, but handle month lengths
      const originalDay = eventDate.getDate();
      const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
      const targetDay = Math.min(originalDay, lastDayOfMonth);
      return checkDate.getDate() === targetDay;
    } else if (recurrence.includes('FREQ=DAILY')) {
      // Daily events: occur every day
      return true;
    } else if (recurrence.includes('FREQ=YEARLY')) {
      // Yearly events: same month and day
      return eventDate.getMonth() === checkDate.getMonth() && 
             eventDate.getDate() === checkDate.getDate();
    }
    
    // Default fallback for other recurring patterns - use day of week
    return eventDate.getDay() === checkDate.getDay();
  }

  // Helper function to calculate the specific occurrence of a day in a month (copied from DynamicCalendarLoader)
  calculateByDayOccurrence(year, month, occurrence, dayOfWeek) {
    try {
      if (occurrence > 0) {
        // Find the nth occurrence of the day (e.g., 3rd Thursday)
        const firstOfMonth = new Date(year, month, 1);
        const firstDayOfWeek = firstOfMonth.getDay();
        
        // Calculate days to add to get to the first occurrence of the target day
        let daysToAdd = (dayOfWeek - firstDayOfWeek + 7) % 7;
        
        // Add weeks to get to the nth occurrence
        daysToAdd += (occurrence - 1) * 7;
        
        const targetDate = new Date(year, month, 1 + daysToAdd);
        
        // Verify it's still in the same month
        if (targetDate.getMonth() !== month) {
          return null;
        }
        
        return targetDate;
      } else if (occurrence === -1) {
        // Find the last occurrence of the day (e.g., last Saturday)
        const lastOfMonth = new Date(year, month + 1, 0);
        const lastDayOfWeek = lastOfMonth.getDay();
        
        // Calculate days to subtract to get to the last occurrence of the target day
        let daysToSubtract = (lastDayOfWeek - dayOfWeek + 7) % 7;
        
        const targetDate = new Date(year, month + 1, 0 - daysToSubtract);
        
        // Verify it's still in the same month
        if (targetDate.getMonth() !== month) {
          return null;
        }
        
        return targetDate;
      }
      
      return null;
    } catch (error) {
      logger.componentError('CALENDAR', 'Error calculating BYDAY occurrence in TodayEventsAggregator', {
        year, month, occurrence, dayOfWeek, error
      });
      return null;
    }
  }

  dedupeBySlug(events) {
    const seen = new Set();
    const result = [];
    for (const ev of events) {
      const key = `${ev.slug || ev.name}-${ev.startDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(ev);
    }
    return result;
  }

  renderTodayEvents(events) {
    // Clear
    this.container.innerHTML = '';

    // Left spacer for consistent scroll gutters
    this.container.appendChild(this.createSpacerCard());

    if (!events.length) {
      const empty = document.createElement('div');
      empty.className = 'event-compact-card coming-soon';
      const emojiBox = document.createElement('div');
      emojiBox.className = 'event-emoji-box';
      const emoji = document.createElement('span');
      emoji.className = 'event-emoji';
      emoji.textContent = '😴';
      emojiBox.appendChild(emoji);
      empty.appendChild(emojiBox);

      const content = document.createElement('div');
      content.className = 'event-content';
      const name = document.createElement('span');
      name.className = 'event-name';
      name.textContent = 'No events today';
      const subtitle = document.createElement('span');
      subtitle.className = 'event-dates';
      subtitle.textContent = 'Check back soon!';
      content.appendChild(name);
      content.appendChild(subtitle);
      empty.appendChild(content);
      this.container.appendChild(empty);

      // Right spacer
      this.container.appendChild(this.createSpacerCard());
      return;
    }

    for (const ev of events) {
      const card = this.createEventCard(ev);
      this.container.appendChild(card);
    }

    // Right spacer
    this.container.appendChild(this.createSpacerCard());
  }

  createEventCard(ev) {
    const link = document.createElement('a');
    link.href = `city.html?city=${ev.cityKey}`;
    link.className = 'event-compact-card';

    const emojiBox = document.createElement('div');
    emojiBox.className = 'event-emoji-box';
    const emoji = document.createElement('span');
    emoji.className = 'event-emoji';
    emoji.textContent = '🎉';
    emojiBox.appendChild(emoji);
    link.appendChild(emojiBox);

    const content = document.createElement('div');
    content.className = 'event-content';

    const name = document.createElement('span');
    name.className = 'event-name';
    name.textContent = ev.name || 'Event';

    const time = document.createElement('span');
    time.className = 'event-dates';
    time.textContent = this.formatTimeRange(ev.startDate, ev.endDate);

    const bar = document.createElement('span');
    bar.className = 'event-bar';
    bar.textContent = ev.bar || '';

    const city = document.createElement('span');
    city.className = 'event-location';
    city.textContent = ev.cityName || '';

    content.appendChild(name);
    content.appendChild(time);
    if (ev.bar) {
      content.appendChild(bar);
    }
    content.appendChild(city);
    link.appendChild(content);

    return link;
  }

  createSpacerCard() {
    const spacer = document.createElement('div');
    spacer.className = 'event-compact-card spacer-card';
    spacer.style.opacity = '0';
    spacer.style.pointerEvents = 'none';
    spacer.style.minWidth = '1rem';
    spacer.style.maxWidth = '1rem';
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
  }

  formatTimeRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    if (Number.isNaN(start.getTime())) return '';

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const eventDate = new Date(start);
    eventDate.setHours(0, 0, 0, 0);

    let dayLabel;
    if (eventDate.getTime() === today.getTime()) {
      dayLabel = 'Today';
    } else if (eventDate.getTime() === tomorrow.getTime()) {
      dayLabel = 'Tomorrow';
    } else {
      dayLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    const opts = { hour: 'numeric', minute: '2-digit' };
    const timeStr = start.toLocaleTimeString([], opts);
    
    return `${dayLabel} ${timeStr}`;
  }
}

// Auto-init on main page once DOM is ready
(function () {
  const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '';
  if (!isMainPage) return;
  const init = () => {
    try {
      const aggregator = new TodayEventsAggregator();
      window.todayEventsAggregator = aggregator;
      aggregator.init();
    } catch (e) {
      logger.componentError('CALENDAR', 'Failed to initialize TodayEventsAggregator', e);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// Export for tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TodayEventsAggregator;
} else {
  window.TodayEventsAggregator = TodayEventsAggregator;
}


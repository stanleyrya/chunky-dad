// Today Events Aggregator - loads cached ICS files and renders events happening today
class TodayEventsAggregator extends CalendarCore {
  constructor() {
    super();
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

      logger.info('CALENDAR', 'Loading cached ICS for today aggregation', { 
        count: selectedCities.length,
        currentDate: new Date().toISOString(),
        dayOfWeek: new Date().getDay()
      });

      const allEvents = await this.loadAllCityEvents(selectedCities);
      logger.info('CALENDAR', 'All events loaded', { 
        total: allEvents.length,
        recurringCount: allEvents.filter(e => e.recurring).length
      });

      const todayEvents = this.filterEventsForToday(allEvents);
      logger.info('CALENDAR', 'Events filtered for today', { 
        todayCount: todayEvents.length,
        events: todayEvents.map(e => ({ name: e.name, recurring: e.recurring, startDate: e.startDate }))
      });

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
      // Use PathUtils if available for consistent path resolution
      if (window.pathUtils) {
        return window.pathUtils.resolvePath(`data/calendars/${cityKey}.ics`);
      }
      
      // Fallback logic for path detection
      const pathname = window.location.pathname || '';
      const isTesting = pathname.includes('/testing/');
      
      // City subdirectories (like /new-york/, /seattle/) need to go up one level
      const pathSegments = pathname.split('/').filter(Boolean);
      const isInCitySubdirectory = pathSegments.length > 0 && 
          window.CITY_CONFIG && 
          window.CITY_CONFIG[pathSegments[0].toLowerCase()];
      
      const needsParentPath = isTesting || isInCitySubdirectory;
      const prefix = needsParentPath ? '../' : '';
      
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

      // For recurring events, use the existing DynamicCalendarLoader logic
      if (ev.recurring && window.calendarLoader) {
        return window.calendarLoader.isRecurringEventInPeriod(ev, startOfToday, endOfTomorrow);
      }

      // For one-time events, check if they fall within the period
      return start >= startOfToday && start < endOfTomorrow;
    });
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

    if (!events.length) {
      const empty = document.createElement('div');
      empty.className = 'event-card detailed today-event-card no-events-card';
      
      const header = document.createElement('div');
      header.className = 'event-header';
      const title = document.createElement('h3');
      title.textContent = 'No events today';
      header.appendChild(title);
      empty.appendChild(header);

      const details = document.createElement('div');
      details.className = 'event-details';
      const messageRow = document.createElement('div');
      messageRow.className = 'detail-row';
      const messageLabel = document.createElement('span');
      messageLabel.className = 'label';
      messageLabel.textContent = '😴';
      const messageValue = document.createElement('span');
      messageValue.className = 'value';
      messageValue.textContent = 'Check back soon for upcoming events!';
      messageRow.appendChild(messageLabel);
      messageRow.appendChild(messageValue);
      details.appendChild(messageRow);
      empty.appendChild(details);

      this.container.appendChild(empty);
      return;
    }

    for (const ev of events) {
      const card = this.createEventCard(ev);
      this.container.appendChild(card);
    }
  }

  createEventCard(ev) {
    const card = document.createElement('div');
    card.className = 'event-card detailed today-event-card';
    card.setAttribute('data-event-slug', ev.slug || '');

    // Event header with title and meta info
    const header = document.createElement('div');
    header.className = 'event-header';

    const title = document.createElement('h3');
    title.textContent = ev.name || 'Event';
    header.appendChild(title);

    // Event meta information (time and city)
    const meta = document.createElement('div');
    meta.className = 'event-meta';

    // Use inherited CalendarCore methods for consistent three-badge system
    const timeDisplay = document.createElement('div');
    timeDisplay.className = 'event-day';
    timeDisplay.textContent = this.getEnhancedDayTimeDisplay(ev);
    meta.appendChild(timeDisplay);

    const recurringBadgeContent = this.getRecurringBadgeContent(ev);
    if (recurringBadgeContent) {
      const recurringBadge = document.createElement('span');
      recurringBadge.className = 'recurring-badge';
      recurringBadge.textContent = recurringBadgeContent;
      meta.appendChild(recurringBadge);
    }

    const dateBadgeContent = this.getDateBadgeContent(ev);
    if (dateBadgeContent) {
      const dateBadge = document.createElement('span');
      dateBadge.className = 'date-badge';
      dateBadge.textContent = dateBadgeContent;
      meta.appendChild(dateBadge);
    }

    header.appendChild(meta);
    card.appendChild(header);

    // Event details - match city page structure
    const details = document.createElement('div');
    details.className = 'event-details';

    // Location - match city page logic
    if (ev.coordinates && ev.coordinates.lat && ev.coordinates.lng) {
      const locationRow = document.createElement('div');
      locationRow.className = 'detail-row';
      const locationLabel = document.createElement('span');
      locationLabel.className = 'label';
      locationLabel.textContent = 'Location:';
      const locationValue = document.createElement('span');
      locationValue.className = 'value';
      const locationLink = document.createElement('a');
      locationLink.href = '#';
      locationLink.className = 'map-link';
      locationLink.textContent = `📍 ${ev.bar || 'Location'}`;
      locationLink.onclick = (e) => {
        e.preventDefault();
        if (window.showOnMap) {
          window.showOnMap(ev.coordinates.lat, ev.coordinates.lng, ev.name, ev.bar || '');
        }
      };
      locationValue.appendChild(locationLink);
      locationRow.appendChild(locationLabel);
      locationRow.appendChild(locationValue);
      details.appendChild(locationRow);
    } else if (ev.bar) {
      const barRow = document.createElement('div');
      barRow.className = 'detail-row';
      const barLabel = document.createElement('span');
      barLabel.className = 'label';
      barLabel.textContent = 'Bar:';
      const barValue = document.createElement('span');
      barValue.className = 'value';
      barValue.textContent = ev.bar;
      barRow.appendChild(barLabel);
      barRow.appendChild(barValue);
      details.appendChild(barRow);
    }

    // Cover - match city page logic (only show if meaningful)
    if (ev.cover && ev.cover.trim() && ev.cover.toLowerCase() !== 'free' && ev.cover.toLowerCase() !== 'no cover') {
      const coverRow = document.createElement('div');
      coverRow.className = 'detail-row';
      const coverLabel = document.createElement('span');
      coverLabel.className = 'label';
      coverLabel.textContent = 'Cover:';
      const coverValue = document.createElement('span');
      coverValue.className = 'value';
      coverValue.textContent = ev.cover;
      coverRow.appendChild(coverLabel);
      coverRow.appendChild(coverValue);
      details.appendChild(coverRow);
    }

    // City information
    const cityRow = document.createElement('div');
    cityRow.className = 'detail-row';
    const cityLabel = document.createElement('span');
    cityLabel.className = 'label';
    cityLabel.textContent = 'City:';
    const cityValue = document.createElement('span');
    cityValue.className = 'value';
    cityValue.textContent = ev.cityName || '';
    cityRow.appendChild(cityLabel);
    cityRow.appendChild(cityValue);
    details.appendChild(cityRow);

    card.appendChild(details);

    // Add link functionality
    card.addEventListener('click', () => {
      window.location.href = `${ev.cityKey}/`;
    });
    card.style.cursor = 'pointer';

    return card;
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

}



// Export for tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TodayEventsAggregator;
} else {
  window.TodayEventsAggregator = TodayEventsAggregator;
}


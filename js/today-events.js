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
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setHours(23, 59, 59, 999);

    return events.filter(ev => {
      const start = new Date(ev.startDate);
      const end = ev.endDate ? new Date(ev.endDate) : null;
      if (Number.isNaN(start.getTime())) return false;

      // Treat no end as same-day event lasting an hour for filtering purposes
      const effectiveEnd = end && !Number.isNaN(end.getTime()) ? end : new Date(start.getTime() + 60 * 60 * 1000);

      // Show if event overlaps today (handles multi-day naturally)
      return start <= endOfToday && effectiveEnd >= startOfToday;
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
    name.textContent = ev.shortName || ev.shorterName || ev.name || 'Event';

    const time = document.createElement('span');
    time.className = 'event-dates';
    time.textContent = this.formatTimeRange(ev.startDate, ev.endDate);

    const location = document.createElement('span');
    location.className = 'event-location';
    location.textContent = `${ev.cityName}${ev.bar ? ' • ' + ev.bar : ''}`;

    content.appendChild(name);
    content.appendChild(time);
    content.appendChild(location);
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

    const sameDay = end && start.toDateString() === end.toDateString();
    const opts = { hour: 'numeric', minute: '2-digit' };
    if (!end) {
      return start.toLocaleTimeString([], opts);
    }
    if (sameDay) {
      return `${start.toLocaleTimeString([], opts)} – ${end.toLocaleTimeString([], opts)}`;
    }
    // Multi-day spanning today: show start or "All day" if midnight
    return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], opts)} – ${end.toLocaleDateString()} ${end.toLocaleTimeString([], opts)}`;
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


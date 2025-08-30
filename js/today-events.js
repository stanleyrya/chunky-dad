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

      // Show loading state
      this.showLoadingState();

      const cities = (window.getAvailableCities ? getAvailableCities() : []).filter(c => hasCityCalendar(c.key));
      const selectedCities = cities.slice(0, this.maxCities);

      logger.info('CALENDAR', 'Loading cached ICS for today aggregation', { count: selectedCities.length });

      const allEvents = await this.loadAllCityEvents(selectedCities);
      const todayEvents = this.filterEventsForToday(allEvents);
      const deduped = this.dedupeBySlug(todayEvents);
      const sorted = deduped.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

      this.renderTodayEvents(sorted);
      logger.componentLoad('CALENDAR', 'TodayEventsAggregator completed', { 
        total: sorted.length,
        events: sorted.map(ev => ({ name: ev.shortName || ev.name, city: ev.cityName, time: this.formatTimeRange(ev.startDate, ev.endDate) }))
      });
    } catch (error) {
      logger.componentError('CALENDAR', 'TodayEventsAggregator failed', error);
      this.showErrorState();
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
      const end = ev.endDate ? new Date(ev.endDate) : null;
      if (Number.isNaN(start.getTime())) return false;

      // Treat no end as same-day event lasting an hour for filtering purposes
      const effectiveEnd = end && !Number.isNaN(end.getTime()) ? end : new Date(start.getTime() + 60 * 60 * 1000);

      // Show if event starts today or tomorrow
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

    // Left spacer for consistent scroll gutters
    this.container.appendChild(this.createSpacerCard());

    if (!events.length) {
      const empty = document.createElement('div');
      empty.className = 'today-event-card coming-soon';
      const emojiBox = document.createElement('div');
      emojiBox.className = 'today-event-emoji-box';
      const emoji = document.createElement('span');
      emoji.className = 'today-event-emoji';
      emoji.textContent = '😴';
      emojiBox.appendChild(emoji);
      empty.appendChild(emojiBox);

      const content = document.createElement('div');
      content.className = 'today-event-content';
      const name = document.createElement('span');
      name.className = 'today-event-name';
      name.textContent = 'No events today';
      const subtitle = document.createElement('span');
      subtitle.className = 'today-event-time';
      subtitle.textContent = 'Check back soon!';
      content.appendChild(name);
      content.appendChild(subtitle);
      empty.appendChild(content);
      this.container.appendChild(empty);

      // Right spacer
      this.container.appendChild(this.createSpacerCard());
      return;
    }

    events.forEach((ev, index) => {
      const card = this.createEventCard(ev);
      // Add staggered animation delay for carousel effect
      card.style.animationDelay = `${index * 0.1}s`;
      this.container.appendChild(card);
    });

    // Right spacer
    this.container.appendChild(this.createSpacerCard());
  }

  createEventCard(ev) {
    const link = document.createElement('a');
    link.href = `city.html?city=${ev.cityKey}`;
    link.className = 'today-event-card';

    const emojiBox = document.createElement('div');
    emojiBox.className = 'today-event-emoji-box';
    const emoji = document.createElement('span');
    emoji.className = 'today-event-emoji';
    
    // Use more specific emojis based on event type or time
    const eventEmoji = this.getEventEmoji(ev);
    emoji.textContent = eventEmoji;
    
    emojiBox.appendChild(emoji);
    link.appendChild(emojiBox);

    const content = document.createElement('div');
    content.className = 'today-event-content';

    const name = document.createElement('span');
    name.className = 'today-event-name';
    name.textContent = ev.shortName || ev.shorterName || ev.name || 'Event';

    const time = document.createElement('span');
    time.className = 'today-event-time';
    time.textContent = this.formatTimeRange(ev.startDate, ev.endDate);

    const city = document.createElement('span');
    city.className = 'today-event-city';
    city.textContent = ev.cityName || '';

    content.appendChild(name);
    content.appendChild(time);
    content.appendChild(city);
    link.appendChild(content);

    return link;
  }

  getEventEmoji(ev) {
    const eventName = (ev.name || '').toLowerCase();
    const eventLocation = (ev.location || '').toLowerCase();
    
    // More specific emojis based on event type
    if (eventName.includes('happy hour') || eventName.includes('cocktail')) return '🍻';
    if (eventName.includes('dance') || eventName.includes('party')) return '💃';
    if (eventName.includes('drag') || eventName.includes('show')) return '👑';
    if (eventName.includes('karaoke')) return '🎤';
    if (eventName.includes('trivia')) return '🧠';
    if (eventName.includes('bingo')) return '🎱';
    if (eventName.includes('leather') || eventName.includes('kink')) return '🖤';
    if (eventName.includes('brunch') || eventName.includes('breakfast')) return '🥞';
    if (eventName.includes('dinner') || eventName.includes('food')) return '🍽️';
    if (eventName.includes('bear') && eventName.includes('night')) return '🐻';
    if (eventName.includes('pool') || eventName.includes('swim')) return '🏊';
    if (eventName.includes('game') || eventName.includes('sport')) return '🎮';
    
    // Time-based emojis
    const hour = new Date(ev.startDate).getHours();
    if (hour >= 6 && hour < 12) return '🌅'; // Morning
    if (hour >= 12 && hour < 17) return '☀️'; // Afternoon
    if (hour >= 17 && hour < 22) return '🌆'; // Evening
    if (hour >= 22 || hour < 6) return '🌙'; // Night
    
    return '🎉'; // Default
  }

  createSpacerCard() {
    const spacer = document.createElement('div');
    spacer.className = 'today-event-card spacer-card';
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
      dayLabel = 'today';
    } else if (eventDate.getTime() === tomorrow.getTime()) {
      dayLabel = 'tomorrow';
    } else {
      dayLabel = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    const opts = { hour: 'numeric', minute: '2-digit' };
    const timeStr = start.toLocaleTimeString([], opts);
    
    return `${dayLabel} ${timeStr}`;
  }

  showLoadingState() {
    this.container.innerHTML = '';
    
    // Left spacer
    this.container.appendChild(this.createSpacerCard());
    
    const loading = document.createElement('div');
    loading.className = 'today-event-card loading';
    
    const emojiBox = document.createElement('div');
    emojiBox.className = 'today-event-emoji-box';
    const emoji = document.createElement('span');
    emoji.className = 'today-event-emoji';
    emoji.textContent = '⏳';
    emojiBox.appendChild(emoji);
    loading.appendChild(emojiBox);

    const content = document.createElement('div');
    content.className = 'today-event-content';
    const name = document.createElement('span');
    name.className = 'today-event-name';
    name.textContent = 'Loading...';
    content.appendChild(name);
    loading.appendChild(content);
    
    this.container.appendChild(loading);
    
    // Right spacer
    this.container.appendChild(this.createSpacerCard());
  }

  showErrorState() {
    this.container.innerHTML = '';
    
    // Left spacer
    this.container.appendChild(this.createSpacerCard());
    
    const error = document.createElement('div');
    error.className = 'today-event-card error';
    
    const emojiBox = document.createElement('div');
    emojiBox.className = 'today-event-emoji-box';
    const emoji = document.createElement('span');
    emoji.className = 'today-event-emoji';
    emoji.textContent = '❌';
    emojiBox.appendChild(emoji);
    error.appendChild(emojiBox);

    const content = document.createElement('div');
    content.className = 'today-event-content';
    const name = document.createElement('span');
    name.className = 'today-event-name';
    name.textContent = 'Error loading';
    const subtitle = document.createElement('span');
    subtitle.className = 'today-event-time';
    subtitle.textContent = 'Try again later';
    content.appendChild(name);
    content.appendChild(subtitle);
    error.appendChild(content);
    
    this.container.appendChild(error);
    
    // Right spacer
    this.container.appendChild(this.createSpacerCard());
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


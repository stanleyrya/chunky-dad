// Platform/aggregator favicons say "Instagram" or "Eventbrite", not the
// festival — showing them as the event's identity would mislead, so those
// cards keep their emoji instead.
const PLATFORM_FAVICON_DOMAINS = ['instagram.com', 'facebook.com', 'eventbrite.com', 'linktr.ee', 'gaytravel4u.com'];

// Unified Compact Card Renderer - Handles both cities and events
class CompactCardRenderer {
    constructor(type, containerSelector) {
        this.type = type; // 'city' or 'event'
        this.containerSelector = containerSelector;
        this.container = null;
        logger.componentInit(this.type.toUpperCase(), `${this.type} compact card renderer initializing`);
    }

    init() {
        this.container = document.querySelector(this.containerSelector);
        if (!this.container) {
            logger.warn(this.type.toUpperCase(), `${this.type} container not found: ${this.containerSelector}`);
            return;
        }

        // renderCards is async (bear events load from data/festivals.json)
        Promise.resolve(this.renderCards()).catch(error => {
            logger.componentError(this.type.toUpperCase(), `${this.type} card rendering failed`, error);
        });
        logger.componentLoad(this.type.toUpperCase(), `${this.type} compact card renderer initialized`);
    }

    async renderCards() {
        const items = await this.getItems();
        if (!items || items.length === 0) {
            logger.error(this.type.toUpperCase(), `No ${this.type} configuration available`);
            return;
        }

        logger.info(this.type.toUpperCase(), `Rendering ${this.type}s dynamically`, { count: items.length });

        // Clear existing content
        this.container.innerHTML = '';

        // Add left spacer for better spacing
        const leftSpacer = this.createSpacerCard();
        this.container.appendChild(leftSpacer);

        // Render each item
        items.forEach(item => {
            const card = this.createCard(item);
            this.container.appendChild(card);
        });

        // Add "More" card
        const moreCard = this.createMoreCard();
        this.container.appendChild(moreCard);

        // Add right spacer for better spacing
        const rightSpacer = this.createSpacerCard();
        this.container.appendChild(rightSpacer);

        logger.componentLoad(this.type.toUpperCase(), `${this.type}s rendered successfully`, { count: items.length });
        
        // Dispatch event to notify that cards are ready
        const event = new CustomEvent(`${this.type}CardsReady`);
        document.dispatchEvent(event);
    }

    getItems() {
        if (this.type === 'city') {
            return window.getAvailableCities ? getAvailableCities() : null;
        } else if (this.type === 'event') {
            // Async: bear events are loaded from data/festivals.json
            return window.getAvailableBearEvents ? getAvailableBearEvents() : null;
        }
        return null;
    }

    // Festivals that live on one of OUR city calendars link to that city page
    // at the festival's dates — not off-site (owner: "just the city page at
    // the correct timeline to start instead of building new page types").
    internalCityHref(item) {
        const key = item.cityKey;
        const cfg = (typeof window !== 'undefined' && window.CITY_CONFIG) ? window.CITY_CONFIG[key] : null;
        if (!key || !cfg || cfg.visible === false) return null;
        const dates = window.getUpcomingEventDates ? getUpcomingEventDates(item) : item;
        const date = (dates && typeof dates.startDate === 'string') ? dates.startDate : null;
        return date ? `${key}/?view=week&date=${date}` : `${key}/`;
    }

    // img/favicons/favicon-<domain>-64px.ico — already downloaded by the
    // image sweep for every festival website. Derived, never hardcoded.
    faviconFor(item) {
        if (this.type !== 'event' || !item.website) return null;
        try {
            const host = new URL(item.website).hostname.replace(/^www\./, '').toLowerCase();
            if (PLATFORM_FAVICON_DOMAINS.includes(host)) return null;
            return `img/favicons/favicon-${host}-64px.ico`;
        } catch (e) {
            return null;
        }
    }

    createCard(item) {
        const link = document.createElement('a');
        link.className = `${this.type}-compact-card`;
        if (this.type === 'city') {
            link.href = `${item.key}/`;
            link.dataset.cityKey = item.key;
        } else {
            const cityHref = this.internalCityHref(item);
            if (cityHref) {
                // Our own city page, opened at the festival's week
                link.href = cityHref;
            } else if (item.website) {
                // No chunky.dad city for it (yet) — the festival's website
                link.href = item.website;
                link.target = '_blank';
                link.rel = 'noopener';
            } else {
                link.href = '#';
            }
        }

        // Create emoji box
        const emojiBox = document.createElement('div');
        emojiBox.className = `${this.type}-emoji-box`;

        const emoji = document.createElement('span');
        emoji.className = `${this.type}-emoji`;
        emoji.textContent = item.emoji;

        emojiBox.appendChild(emoji);

        // Festival cards show the event site's favicon when we have one; the
        // emoji stays in the DOM and comes back if the image 404s
        const favUrl = this.faviconFor(item);
        if (favUrl) {
            const favImg = document.createElement('img');
            favImg.className = 'event-favicon';
            favImg.src = favUrl;
            favImg.alt = '';
            favImg.loading = 'lazy';
            favImg.addEventListener('error', () => {
                favImg.remove();
                emojiBox.classList.remove('has-favicon');
            });
            emojiBox.classList.add('has-favicon');
            emojiBox.appendChild(favImg);
        }

        link.appendChild(emojiBox);

        // Create content based on type
        if (this.type === 'city') {
            const name = document.createElement('span');
            name.className = 'city-name';
            name.textContent = item.name;
            link.appendChild(name);
        } else if (this.type === 'event') {
            const content = document.createElement('div');
            content.className = 'event-content';

            const name = document.createElement('span');
            name.className = 'bear-event-name';
            name.textContent = item.name;

            const dates = document.createElement('span');
            dates.className = 'event-dates';
            if (item.startDate && item.endDate) {
                dates.textContent = window.formatEventDates ? formatEventDates(item) : `${item.startDate} - ${item.endDate}`;
            } else {
                // Undated (or past recurring) festival: show typical timing instead
                dates.textContent = item.typicalTiming || item.tagline || '';
            }

            const location = document.createElement('span');
            location.className = 'event-location';
            location.textContent = item.location;

            content.appendChild(name);
            content.appendChild(dates);
            content.appendChild(location);
            link.appendChild(content);
        }

        return link;
    }

    createMoreCard() {
        const card = document.createElement('div');
        card.className = `${this.type}-compact-card coming-soon`;
        
        // Add proper ID for button functionality
        if (this.type === 'city') {
            card.id = 'more-cities-btn';
        } else if (this.type === 'event') {
            card.id = 'more-events-btn';
        }

        const emojiBox = document.createElement('div');
        emojiBox.className = `${this.type}-emoji-box`;

        const emoji = document.createElement('span');
        emoji.className = `${this.type}-emoji`;
        emoji.textContent = this.type === 'city' ? '🌍' : '📅';

        emojiBox.appendChild(emoji);
        card.appendChild(emojiBox);

        if (this.type === 'city') {
            const name = document.createElement('span');
            name.className = 'city-name';
            name.textContent = 'Suggest a City';
            card.appendChild(name);
        } else if (this.type === 'event') {
            const content = document.createElement('div');
            content.className = 'event-content';

            const name = document.createElement('span');
            name.className = 'bear-event-name';
            name.textContent = 'More Events';

            const subtitle = document.createElement('span');
            subtitle.className = 'event-dates';
            subtitle.textContent = 'Suggest an Event';

            content.appendChild(name);
            content.appendChild(subtitle);
            card.appendChild(content);
        }

        return card;
    }

    createSpacerCard() {
        const spacer = document.createElement('div');
        spacer.className = `${this.type}-compact-card spacer-card`;
        spacer.style.opacity = '0';
        spacer.style.pointerEvents = 'none';
        spacer.style.minWidth = '1rem';
        spacer.style.maxWidth = '1rem';
        spacer.setAttribute('aria-hidden', 'true');
        
        return spacer;
    }
}

// Convenience classes for backward compatibility
class CityRenderer extends CompactCardRenderer {
    constructor() {
        super('city', '.city-compact-grid');
    }

    init() {
        super.init();
        this.initSearch();
        this.initLocationSort();
    }

    // Location-aware ordering: nearest cities first. On load this only uses a
    // cached fix or an already-granted permission (never prompts); the 📍
    // button is the ONE place a permission prompt may appear, because it's a
    // user gesture (iOS suppresses prompts detached from a tap).
    initLocationSort() {
        if (!window.LocationManager) return;
        if (!window.locationManager) {
            window.locationManager = new LocationManager();
        }
        this.locationManager = window.locationManager;

        const btn = document.getElementById('near-me-btn');

        const trySilent = () => {
            this.locationManager.getLocationForFeatures()
                .then(loc => { if (loc) this.applyDistanceOrder(loc, btn); })
                .catch(() => {});
        };
        // cards render async — sort once they exist
        if (this.container && this.container.querySelector('[data-city-key]')) {
            trySilent();
        } else {
            document.addEventListener('cityCardsReady', trySilent, { once: true });
        }

        if (!btn) return;
        btn.addEventListener('click', async () => {
            btn.classList.remove('near-me-error');
            btn.classList.add('near-me-loading');
            try {
                const loc = await this.locationManager.getCurrentLocation();
                this.applyDistanceOrder(loc, btn);
            } catch (e) {
                btn.classList.add('near-me-error');
                btn.title = (e && e.message) ? e.message : 'Unable to get your location';
                logger.warn('CITY', 'Near-me sort failed', { error: e?.message });
            } finally {
                btn.classList.remove('near-me-loading');
            }
        });
    }

    applyDistanceOrder(location, btn) {
        if (!location || !this.container) return;
        const cards = Array.from(this.container.querySelectorAll('.city-compact-card[data-city-key]'));
        if (cards.length < 2) return;
        const cfg = window.CITY_CONFIG || {};
        const dist = (card) => {
            const c = cfg[card.dataset.cityKey];
            if (!c || !c.coordinates) return Number.MAX_SAFE_INTEGER;
            return this.locationManager.calculateDistance(
                location.lat, location.lng, c.coordinates.lat, c.coordinates.lng);
        };
        const sorted = cards.slice().sort((a, b) => dist(a) - dist(b));
        // re-seat the contiguous card run in place (spacer/suggest cards stay put)
        const next = cards[cards.length - 1].nextSibling;
        sorted.forEach(card => this.container.insertBefore(card, next));
        if (btn) {
            btn.classList.add('near-me-active');
            btn.title = 'Cities sorted by distance from you';
        }
        logger.info('CITY', 'Cities sorted by distance from user', {
            nearest: sorted[0] ? sorted[0].dataset.cityKey : null
        });
    }

    initSearch() {
        const searchInput = document.getElementById('city-search');
        if (!searchInput) return;

        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase().trim();
            const cards = this.container.querySelectorAll('.city-compact-card:not(.spacer-card):not(.coming-soon)');

            cards.forEach(card => {
                const cityNameElement = card.querySelector('.city-name');
                if (cityNameElement) {
                    const cityName = cityNameElement.textContent.toLowerCase();
                    if (cityName.includes(searchTerm)) {
                        card.style.display = 'flex';
                    } else {
                        card.style.display = 'none';
                    }
                }
            });

            if (window.homeMap) {
                window.homeMap.filterMarkers(searchTerm);
            }
        });
    }
}

class BearEventRenderer extends CompactCardRenderer {
    constructor() {
        super('event', '.event-compact-grid');
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CompactCardRenderer, CityRenderer, BearEventRenderer };
} else {
    window.CompactCardRenderer = CompactCardRenderer;
    window.CityRenderer = CityRenderer;
    window.BearEventRenderer = BearEventRenderer;
}
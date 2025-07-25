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

        this.renderCards();
        logger.componentLoad(this.type.toUpperCase(), `${this.type} compact card renderer initialized`);
    }

    renderCards() {
        const items = this.getItems();
        if (!items || items.length === 0) {
            logger.error(this.type.toUpperCase(), `No ${this.type} configuration available`);
            return;
        }

        logger.info(this.type.toUpperCase(), `Rendering ${this.type}s dynamically`, { count: items.length });

        // Clear existing content
        this.container.innerHTML = '';

        // Render each item
        items.forEach(item => {
            const card = this.createCard(item);
            this.container.appendChild(card);
        });

        // Add "More" card
        const moreCard = this.createMoreCard();
        this.container.appendChild(moreCard);

        logger.componentLoad(this.type.toUpperCase(), `${this.type}s rendered successfully`, { count: items.length });
    }

    getItems() {
        if (this.type === 'city') {
            return window.getAvailableCities ? getAvailableCities() : null;
        } else if (this.type === 'event') {
            return window.getAvailableBearEvents ? getAvailableBearEvents() : null;
        }
        return null;
    }

    createCard(item) {
        const link = document.createElement('a');
        link.href = `${this.type}.html?${this.type}=${item.key}`;
        link.className = `${this.type}-compact-card`;

        // Create emoji box
        const emojiBox = document.createElement('div');
        emojiBox.className = `${this.type}-emoji-box`;

        const emoji = document.createElement('span');
        emoji.className = `${this.type}-emoji`;
        emoji.textContent = item.emoji;

        emojiBox.appendChild(emoji);
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
            name.className = 'event-name';
            name.textContent = item.name;

            const dates = document.createElement('span');
            dates.className = 'event-dates';
            dates.textContent = window.formatEventDates ? formatEventDates(item) : `${item.startDate} - ${item.endDate}`;

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

        const emojiBox = document.createElement('div');
        emojiBox.className = `${this.type}-emoji-box`;

        const emoji = document.createElement('span');
        emoji.className = `${this.type}-emoji`;
        emoji.textContent = this.type === 'city' ? '🌍' : '🎉';

        emojiBox.appendChild(emoji);
        card.appendChild(emojiBox);

        if (this.type === 'city') {
            const name = document.createElement('span');
            name.className = 'city-name';
            name.textContent = 'More Cities';
            card.appendChild(name);
        } else if (this.type === 'event') {
            const content = document.createElement('div');
            content.className = 'event-content';

            const name = document.createElement('span');
            name.className = 'event-name';
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
}

// Convenience classes for backward compatibility
class CityRenderer extends CompactCardRenderer {
    constructor() {
        super('city', '.city-compact-grid');
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
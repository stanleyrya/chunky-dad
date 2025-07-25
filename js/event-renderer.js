// Bear Events Renderer - Dynamically renders bear event cards from configuration
class BearEventRenderer {
    constructor() {
        this.eventContainer = null;
        logger.componentInit('EVENT', 'Bear event renderer initializing');
    }

    init() {
        this.eventContainer = document.querySelector('.event-compact-grid');
        if (!this.eventContainer) {
            logger.warn('EVENT', 'Bear event container not found');
            return;
        }

        this.renderEvents();
        logger.componentLoad('EVENT', 'Bear event renderer initialized');
    }

    renderEvents() {
        if (!window.getAvailableBearEvents) {
            logger.error('EVENT', 'Bear event configuration not available');
            return;
        }

        const events = getAvailableBearEvents();
        logger.info('EVENT', 'Rendering bear events dynamically', { count: events.length });

        // Clear existing content
        this.eventContainer.innerHTML = '';

        // Render each event
        events.forEach(event => {
            const eventCard = this.createEventCard(event);
            this.eventContainer.appendChild(eventCard);
        });

        // Add "More Events" card
        const moreEventsCard = this.createMoreEventsCard();
        this.eventContainer.appendChild(moreEventsCard);

        logger.componentLoad('EVENT', 'Bear events rendered successfully', { count: events.length });
    }

    createEventCard(event) {
        const link = document.createElement('a');
        link.href = `event.html?event=${event.key}`;
        link.className = 'event-compact-card';

        const emojiBox = document.createElement('div');
        emojiBox.className = 'event-emoji-box';

        const emoji = document.createElement('span');
        emoji.className = 'event-emoji';
        emoji.textContent = event.emoji;

        const content = document.createElement('div');
        content.className = 'event-content';

        const name = document.createElement('span');
        name.className = 'event-name';
        name.textContent = event.name;

        const dates = document.createElement('span');
        dates.className = 'event-dates';
        dates.textContent = event.dates;

        const location = document.createElement('span');
        location.className = 'event-location';
        location.textContent = event.location;

        content.appendChild(name);
        content.appendChild(dates);
        content.appendChild(location);

        emojiBox.appendChild(emoji);
        link.appendChild(emojiBox);
        link.appendChild(content);

        return link;
    }

    createMoreEventsCard() {
        const card = document.createElement('div');
        card.className = 'event-compact-card coming-soon';

        const emojiBox = document.createElement('div');
        emojiBox.className = 'event-emoji-box';

        const emoji = document.createElement('span');
        emoji.className = 'event-emoji';
        emoji.textContent = '🎉';

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

        emojiBox.appendChild(emoji);
        card.appendChild(emojiBox);
        card.appendChild(content);

        return card;
    }
}

// Initialize when DOM is ready
function initializeBearEventRenderer() {
    const eventRenderer = new BearEventRenderer();
    eventRenderer.init();
    
    // Make globally accessible
    window.bearEventRenderer = eventRenderer;
}

// Don't auto-initialize - let the main app handle initialization

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BearEventRenderer;
} else {
    window.BearEventRenderer = BearEventRenderer;
}
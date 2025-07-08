// City Events Dynamic Loader
class CityEventsLoader {
    constructor() {
        this.eventsData = null;
    }

    async loadEventsData() {
        try {
            const response = await fetch('data/events.json');
            this.eventsData = await response.json();
            return this.eventsData;
        } catch (error) {
            console.error('Error loading events data:', error);
            return null;
        }
    }

    getCityFromUrl() {
        const path = window.location.pathname;
        const filename = path.split('/').pop().replace('.html', '');
        return filename === 'index' ? null : filename;
    }

    generateEventCard(event) {
        const linksHtml = event.links ? event.links.map(link => 
            `<a href="${link.url}" target="_blank" rel="noopener">${link.label}</a>`
        ).join('') : '';

        const teaHtml = event.tea ? `
            <div class="detail-row tea">
                <span class="label">Tea:</span>
                <span class="value">${event.tea}</span>
            </div>
        ` : '';

        return `
            <div class="event-card detailed">
                <div class="event-header">
                    <h3>${event.name}</h3>
                    <div class="event-day">${event.day} ${event.time}</div>
                </div>
                <div class="event-details">
                    <div class="detail-row">
                        <span class="label">Bar:</span>
                        <span class="value">${event.bar}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">Cover:</span>
                        <span class="value">${event.cover}</span>
                    </div>
                    ${teaHtml}
                    <div class="event-links">
                        ${linksHtml}
                    </div>
                </div>
            </div>
        `;
    }

    generateCalendarEvents(events) {
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const eventsByDay = {};

        // Initialize all days
        daysOfWeek.forEach(day => {
            eventsByDay[day] = [];
        });

        // Group events by day
        [...events.weeklyEvents, ...events.routineEvents].forEach(event => {
            if (eventsByDay[event.day]) {
                eventsByDay[event.day].push(event.name);
            }
        });

        return daysOfWeek.map(day => {
            const eventsHtml = eventsByDay[day].length > 0 
                ? eventsByDay[day].map(eventName => `<div class="event-item">${eventName}</div>`).join('')
                : '<!-- No events -->';

            const isToday = new Date().getDay() === daysOfWeek.indexOf(day);
            const currentClass = isToday ? ' current' : '';

            return `
                <div class="calendar-day${currentClass}">
                    <h3>${day}</h3>
                    <div class="events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    async renderCityPage(cityKey) {
        if (!this.eventsData) {
            await this.loadEventsData();
        }

        if (!this.eventsData || !this.eventsData.cities[cityKey]) {
            console.error(`City data not found for: ${cityKey}`);
            return;
        }

        const cityData = this.eventsData.cities[cityKey];

        // Update city header
        const cityHeader = document.querySelector('.city-header h1');
        const cityTagline = document.querySelector('.city-tagline');
        
        if (cityHeader) cityHeader.textContent = `${cityData.emoji} ${cityData.name}`;
        if (cityTagline) cityTagline.textContent = cityData.tagline;

        // Update calendar
        const calendarGrid = document.querySelector('.calendar-grid');
        if (calendarGrid) {
            calendarGrid.innerHTML = this.generateCalendarEvents(cityData);
        }

        // Update weekly events
        const weeklyEventsList = document.querySelector('.weekly-events .events-list');
        if (weeklyEventsList && cityData.weeklyEvents) {
            weeklyEventsList.innerHTML = cityData.weeklyEvents.map(event => 
                this.generateEventCard(event)
            ).join('');
        }

        // Update routine events
        const routineEventsList = document.querySelector('.routine-events .events-list');
        if (routineEventsList && cityData.routineEvents) {
            routineEventsList.innerHTML = cityData.routineEvents.map(event => 
                this.generateEventCard(event)
            ).join('');
        }

        // Update page title
        document.title = `${cityData.name} - Chunky Dad Bear Guide`;
        
        // Update meta description
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            metaDescription.setAttribute('content', 
                `Complete gay bear guide to ${cityData.name} - events, bars, and the hottest bear scene`
            );
        }
    }

    async init() {
        const cityKey = this.getCityFromUrl();
        if (cityKey) {
            await this.renderCityPage(cityKey);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const cityLoader = new CityEventsLoader();
    cityLoader.init();
});

// Export for potential use in other scripts
window.CityEventsLoader = CityEventsLoader;
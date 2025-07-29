// Display Handler - Web Environment
// Handles result formatting and display specifically for web browsers

class WebDisplayHandler {
    constructor(config = {}) {
        this.config = {
            maxEventsPerPage: config.maxEventsPerPage || 50,
            enablePagination: config.enablePagination !== false,
            showDebugInfo: config.showDebugInfo || false,
            ...config
        };
    }

    // Display results as HTML elements
    async displayAsHTML(results, options = {}) {
        try {
            console.log('🌐 Web: Generating HTML display');
            
            const container = document.createElement('div');
            container.className = 'bear-events-results';
            
            // Add CSS styles
            this.addStyles();
            
            // Header section
            const header = this.createHeader(results);
            container.appendChild(header);
            
            // Stats section
            const stats = this.createStatsSection(results);
            container.appendChild(stats);
            
            // Events section
            if (results.bearEventCount > 0) {
                const eventsSection = this.createEventsSection(results, options);
                container.appendChild(eventsSection);
            } else {
                const noEventsSection = this.createNoEventsSection();
                container.appendChild(noEventsSection);
            }
            
            // Debug section (if enabled)
            if (this.config.showDebugInfo) {
                const debugSection = this.createDebugSection(results);
                container.appendChild(debugSection);
            }
            
            return {
                success: true,
                type: 'html',
                element: container,
                eventsDisplayed: results.bearEventCount
            };
            
        } catch (error) {
            console.error('🌐 Web: Failed to generate HTML display:', error);
            return {
                success: false,
                type: 'html',
                error: error.message
            };
        }
    }

    createHeader(results) {
        const header = document.createElement('div');
        header.className = 'bear-events-header';
        header.innerHTML = `
            <h2 style="margin: 0 0 20px 0; font-size: 1.8em; color: #333;">
                🐻 Bear Event Scraper Results
            </h2>
        `;
        return header;
    }

    createStatsSection(results) {
        const stats = document.createElement('div');
        stats.className = 'bear-events-stats';
        
        const successRate = results.totalSources > 0 
            ? Math.round((results.successfulSources / results.totalSources) * 100) 
            : 0;
        
        stats.innerHTML = `
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
                    <div style="text-align: center;">
                        <div style="font-size: 2em; font-weight: bold; color: #007cba;">${results.bearEventCount}</div>
                        <div style="color: #666;">Bear Events Found</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 2em; font-weight: bold; color: #28a745;">${results.totalSources}</div>
                        <div style="color: #666;">Sources Searched</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 2em; font-weight: bold; color: #ffc107;">${successRate}%</div>
                        <div style="color: #666;">Success Rate</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 1.2em; color: #666;">${new Date().toLocaleString()}</div>
                        <div style="color: #666;">Last Updated</div>
                    </div>
                </div>
            </div>
        `;
        
        return stats;
    }

    createEventsSection(results, options) {
        const section = document.createElement('div');
        section.className = 'bear-events-list';
        
        // Group events by city if requested
        const groupByCity = options.groupByCity || false;
        
        if (groupByCity) {
            const eventsByCity = this.groupEventsByCity(results.events);
            
            Object.entries(eventsByCity).forEach(([city, events]) => {
                const citySection = document.createElement('div');
                citySection.className = 'city-section';
                citySection.innerHTML = `<h3 style="color: #007cba; margin: 30px 0 15px 0; text-transform: uppercase;">${city} (${events.length})</h3>`;
                
                events.forEach(event => {
                    const eventCard = this.createEventCard(event);
                    citySection.appendChild(eventCard);
                });
                
                section.appendChild(citySection);
            });
        } else {
            // Display all events in chronological order
            const sortedEvents = [...results.events].sort((a, b) => {
                if (!a.date && !b.date) return 0;
                if (!a.date) return 1;
                if (!b.date) return -1;
                return new Date(a.date) - new Date(b.date);
            });
            
            sortedEvents.forEach(event => {
                const eventCard = this.createEventCard(event);
                section.appendChild(eventCard);
            });
        }
        
        return section;
    }

    createEventCard(event) {
        const card = document.createElement('div');
        card.className = 'event-card';
        
        const date = event.date ? new Date(event.date).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }) : 'Date TBD';
        
        const time = event.date ? new Date(event.date).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        }) : '';
        
        card.innerHTML = `
            <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 15px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="display: grid; grid-template-columns: 1fr auto; gap: 20px; align-items: start;">
                    <div>
                        <h3 style="margin: 0 0 10px 0; color: #333; font-size: 1.3em;">${this.escapeHtml(event.title)}</h3>
                        
                        <div style="display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 15px; color: #666;">
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <span>📅</span>
                                <span>${date}${time ? ` at ${time}` : ''}</span>
                            </div>
                            ${event.venue ? `
                                <div style="display: flex; align-items: center; gap: 5px;">
                                    <span>📍</span>
                                    <span>${this.escapeHtml(event.venue)}</span>
                                </div>
                            ` : ''}
                            ${event.city && event.city !== 'unknown' ? `
                                <div style="display: flex; align-items: center; gap: 5px;">
                                    <span>🏙️</span>
                                    <span>${event.city.toUpperCase()}</span>
                                </div>
                            ` : ''}
                        </div>
                        
                        ${event.description ? `
                            <p style="margin: 0 0 15px 0; color: #555; line-height: 1.5;">
                                ${this.escapeHtml(event.description)}
                            </p>
                        ` : ''}
                        
                        <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">
                            <span style="background: #007cba; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8em;">
                                ${this.escapeHtml(event.source)}
                            </span>
                            ${event.eventUrl ? `
                                <a href="${event.eventUrl}" target="_blank" style="color: #007cba; text-decoration: none; font-size: 0.9em;">
                                    View Details →
                                </a>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div style="text-align: center; min-width: 60px;">
                        <div style="background: #f8f9fa; border-radius: 8px; padding: 10px; font-size: 0.8em; color: #666;">
                            ${event.date ? new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'}
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        return card;
    }

    createNoEventsSection() {
        const section = document.createElement('div');
        section.className = 'no-events';
        section.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #666;">
                <div style="font-size: 3em; margin-bottom: 20px;">🐻</div>
                <h3 style="margin: 0 0 10px 0; color: #333;">No Bear Events Found</h3>
                <p style="margin: 0; font-size: 1.1em;">Try adjusting your search criteria or check back later for new events.</p>
            </div>
        `;
        return section;
    }

    createDebugSection(results) {
        const section = document.createElement('div');
        section.className = 'debug-info';
        section.innerHTML = `
            <div style="background: #f8f9fa; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-top: 30px;">
                <h4 style="margin: 0 0 15px 0; color: #333;">Debug Information</h4>
                <pre style="background: #fff; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 0.9em;">
${JSON.stringify({
    totalSources: results.totalSources,
    successfulSources: results.successfulSources,
    bearEventCount: results.bearEventCount,
    processingStats: results.processingStats,
    comprehensiveStats: results.comprehensiveStats
}, null, 2)}
                </pre>
            </div>
        `;
        return section;
    }

    groupEventsByCity(events) {
        const grouped = {};
        
        events.forEach(event => {
            const city = event.city || 'Unknown';
            if (!grouped[city]) {
                grouped[city] = [];
            }
            grouped[city].push(event);
        });
        
        // Sort cities by event count (descending)
        const sortedCities = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);
        const sortedGrouped = {};
        sortedCities.forEach(city => {
            sortedGrouped[city] = grouped[city];
        });
        
        return sortedGrouped;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    addStyles() {
        // Only add styles once
        if (document.getElementById('bear-events-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'bear-events-styles';
        styles.textContent = `
            .bear-events-results {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }
            
            .event-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 8px rgba(0,0,0,0.15) !important;
                transition: all 0.2s ease;
            }
            
            @media (max-width: 768px) {
                .bear-events-results {
                    padding: 10px;
                }
                
                .event-card > div {
                    grid-template-columns: 1fr !important;
                    gap: 10px !important;
                }
                
                .bear-events-stats > div > div {
                    grid-template-columns: repeat(2, 1fr) !important;
                }
            }
        `;
        
        document.head.appendChild(styles);
    }

    // Generate JSON export
    generateJSONExport(results, options = {}) {
        try {
            const exportData = {
                metadata: {
                    generatedAt: new Date().toISOString(),
                    totalEvents: results.bearEventCount,
                    totalSources: results.totalSources,
                    successfulSources: results.successfulSources
                },
                events: results.events.map(event => ({
                    title: event.title,
                    date: event.date,
                    venue: event.venue,
                    city: event.city,
                    description: event.description,
                    source: event.source,
                    url: event.eventUrl || event.url
                }))
            };
            
            return {
                success: true,
                type: 'json',
                content: JSON.stringify(exportData, null, 2)
            };
            
        } catch (error) {
            console.error('🌐 Web: Failed to generate JSON export:', error);
            return {
                success: false,
                type: 'json',
                error: error.message
            };
        }
    }

    // Main display method
    async displayResults(results, options = {}) {
        const format = options.format || 'html';
        
        switch (format) {
            case 'html':
                return await this.displayAsHTML(results, options);
            case 'json':
                return this.generateJSONExport(results, options);
            default:
                console.warn(`🌐 Web: Unknown display format: ${format}, using HTML`);
                return await this.displayAsHTML(results, options);
        }
    }
}

// Export for web environment
if (typeof window !== 'undefined') {
    window.WebDisplayHandler = WebDisplayHandler;
} else if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebDisplayHandler };
}
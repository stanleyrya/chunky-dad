// Display Adapters - Handle different output formats for both environments
// Provides unified interface for displaying results regardless of environment

class DisplayAdapter {
    constructor(environment = 'auto') {
        this.environment = environment === 'auto' ? this.detectEnvironment() : environment;
        this.isScriptable = this.environment === 'scriptable';
    }

    detectEnvironment() {
        return typeof importModule !== 'undefined' ? 'scriptable' : 'web';
    }

    // Abstract method - implement in subclasses
    async displayResults(results, config) {
        throw new Error('displayResults must be implemented by subclass');
    }
}

class WebDisplayAdapter extends DisplayAdapter {
    constructor() {
        super('web');
    }

    async displayResults(results, config = {}) {
        if (config.format === 'json') {
            return this.displayJSON(results);
        } else if (config.format === 'table') {
            return this.displayTable(results);
        } else {
            return this.displayHTML(results);
        }
    }

    displayJSON(results) {
        const output = document.createElement('pre');
        output.style.cssText = `
            background: #f5f5f5;
            padding: 20px;
            border-radius: 5px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            white-space: pre-wrap;
        `;
        output.textContent = JSON.stringify(results, null, 2);
        
        return {
            element: output,
            text: JSON.stringify(results, null, 2)
        };
    }

    displayTable(results) {
        if (!results.events || results.events.length === 0) {
            return this.displayHTML({ message: 'No events found' });
        }

        const table = document.createElement('table');
        table.style.cssText = `
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-family: Arial, sans-serif;
        `;

        // Header
        const header = table.createTHead();
        const headerRow = header.insertRow();
        const columns = ['Title', 'Date', 'Venue', 'City', 'Source'];
        
        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            th.style.cssText = `
                background: #333;
                color: white;
                padding: 10px;
                text-align: left;
                border: 1px solid #ddd;
            `;
            headerRow.appendChild(th);
        });

        // Body
        const tbody = table.createTBody();
        results.events.forEach(event => {
            const row = tbody.insertRow();
            const cells = [
                event.title || 'N/A',
                event.date ? new Date(event.date).toLocaleDateString() : 'N/A',
                event.venue || 'N/A',
                event.city || 'N/A',
                event.source || 'N/A'
            ];

            cells.forEach(cellText => {
                const cell = row.insertCell();
                cell.textContent = cellText;
                cell.style.cssText = `
                    padding: 8px 10px;
                    border: 1px solid #ddd;
                    background: ${event.isBearEvent ? '#e8f5e8' : '#fff'};
                `;
            });
        });

        return {
            element: table,
            text: this.tableToText(results.events)
        };
    }

    displayHTML(results) {
        const container = document.createElement('div');
        container.style.cssText = `
            font-family: Arial, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
        `;

        // Enhanced Summary Section
        const summary = document.createElement('div');
        summary.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 10px;
            margin-bottom: 25px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        `;

        const eventCount = results.events ? results.events.length : 0;
        const bearEventCount = results.events ? results.events.filter(e => e.isBearEvent).length : 0;
        const stats = results.comprehensiveStats || {};
        const processingStats = results.processingStats || {};

        summary.innerHTML = `
            <h2 style="margin: 0 0 20px 0; font-size: 1.8em;">🐻 Bear Event Scraper Results</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                <div style="text-align: center;">
                    <div style="font-size: 2.5em; font-weight: bold; margin-bottom: 5px;">${eventCount}</div>
                    <div style="opacity: 0.9;">Final Events</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 2.5em; font-weight: bold; margin-bottom: 5px; color: #4CAF50;">${bearEventCount}</div>
                    <div style="opacity: 0.9;">Bear Events</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 2.5em; font-weight: bold; margin-bottom: 5px;">${stats.totals?.totalEventsFound || 0}</div>
                    <div style="opacity: 0.9;">Total Found</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 2.5em; font-weight: bold; margin-bottom: 5px; color: #ff6b6b;">${stats.totals?.discardedEventsTotal || 0}</div>
                    <div style="opacity: 0.9;">Discarded</div>
                </div>
            </div>
            <div style="margin-top: 20px; text-align: center; opacity: 0.9;">
                Success Rate: ${stats.overallSuccessRate || 0}% | 
                Bear Event Rate: ${stats.overallBearEventRate || 0}% | 
                Sources: ${results.successfulSources || 0}/${results.totalSources || 0}
            </div>
        `;
        container.appendChild(summary);

        // Processing Statistics Section
        if (stats.totals) {
            const processingSection = document.createElement('div');
            processingSection.style.cssText = `
                background: white;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            `;
            
            processingSection.innerHTML = `
                <h3 style="margin: 0 0 15px 0; color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px;">
                    📊 Processing Statistics
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                        <h4 style="margin: 0 0 10px 0; color: #495057;">Event Processing</h4>
                        <div>Total Parsed: <strong>${stats.totals.totalParsed}</strong></div>
                        <div>Valid Events: <strong style="color: #28a745;">${stats.totals.validEvents}</strong></div>
                        <div>Invalid Events: <strong style="color: #dc3545;">${stats.totals.invalidEvents}</strong></div>
                        <div>Processing Errors: <strong style="color: #ffc107;">${stats.totals.processingErrors}</strong></div>
                    </div>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                        <h4 style="margin: 0 0 10px 0; color: #495057;">Event Classification</h4>
                        <div>Bear Events: <strong style="color: #4CAF50;">${stats.totals.bearEvents}</strong></div>
                        <div>Non-Bear Events: <strong>${stats.totals.nonBearEvents}</strong></div>
                        <div>Events with Dates: <strong>${stats.totals.eventsWithDates}</strong></div>
                        <div>Events without Dates: <strong>${stats.totals.eventsWithoutDates}</strong></div>
                    </div>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                        <h4 style="margin: 0 0 10px 0; color: #495057;">Filtering Results</h4>
                        <div>Duplicates Removed: <strong style="color: #6c757d;">${stats.totals.duplicatesRemoved}</strong></div>
                        <div>Past Events Filtered: <strong style="color: #6c757d;">${stats.totals.pastEventsFiltered}</strong></div>
                        <div>Date Range Filtered: <strong style="color: #6c757d;">${stats.totals.dateRangeFiltered || 0}</strong></div>
                        <div>Final Count: <strong style="color: #007bff;">${stats.totals.finalEventCount}</strong></div>
                    </div>
                </div>
            `;
            container.appendChild(processingSection);
        }

        // Source Performance Section
        if (stats.sourcePerformance && stats.sourcePerformance.length > 0) {
            const sourceSection = document.createElement('div');
            sourceSection.style.cssText = `
                background: white;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            `;
            
            let sourceTableHTML = `
                <h3 style="margin: 0 0 15px 0; color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px;">
                    🔍 Source Performance
                </h3>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <thead>
                            <tr style="background: #f8f9fa;">
                                <th style="padding: 12px; text-align: left; border: 1px solid #dee2e6;">Source</th>
                                <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">Parsed</th>
                                <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">Valid</th>
                                <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">Bear Events</th>
                                <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">Discarded</th>
                                <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">Success Rate</th>
                                <th style="padding: 12px; text-align: center; border: 1px solid #dee2e6;">Bear Rate</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            stats.sourcePerformance.forEach(source => {
                const successColor = source.successRate >= 80 ? '#28a745' : 
                                   source.successRate >= 50 ? '#ffc107' : '#dc3545';
                const bearColor = source.bearEventRate >= 50 ? '#4CAF50' : 
                                source.bearEventRate >= 20 ? '#ff9800' : '#6c757d';
                
                sourceTableHTML += `
                    <tr>
                        <td style="padding: 10px; border: 1px solid #dee2e6;">
                            <strong>${source.source}</strong>
                        </td>
                        <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${source.totalParsed}</td>
                        <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6;">${source.validEvents}</td>
                        <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: #4CAF50;">${source.bearEvents}</td>
                        <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: #dc3545;">${source.discardedEvents}</td>
                        <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: ${successColor}; font-weight: bold;">${source.successRate}%</td>
                        <td style="padding: 10px; text-align: center; border: 1px solid #dee2e6; color: ${bearColor}; font-weight: bold;">${source.bearEventRate}%</td>
                    </tr>
                `;
            });
            
            sourceTableHTML += `
                        </tbody>
                    </table>
                </div>
            `;
            
            sourceSection.innerHTML = sourceTableHTML;
            container.appendChild(sourceSection);
        }

        // Bear Keyword Matches Section
        if (stats.bearKeywordMatches && Object.keys(stats.bearKeywordMatches).length > 0) {
            const keywordSection = document.createElement('div');
            keywordSection.style.cssText = `
                background: white;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            `;
            
            const sortedKeywords = Object.entries(stats.bearKeywordMatches)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 15); // Top 15 keywords
            
            let keywordHTML = `
                <h3 style="margin: 0 0 15px 0; color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px;">
                    🐻 Bear Keyword Matches (Top 15)
                </h3>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            `;
            
            sortedKeywords.forEach(([keyword, count]) => {
                const intensity = Math.min(count / Math.max(...Object.values(stats.bearKeywordMatches)), 1);
                const opacity = 0.6 + (intensity * 0.4);
                keywordHTML += `
                    <span style="
                        background: rgba(76, 175, 80, ${opacity});
                        color: white;
                        padding: 6px 12px;
                        border-radius: 20px;
                        font-size: 12px;
                        font-weight: bold;
                        white-space: nowrap;
                    ">
                        ${keyword} (${count})
                    </span>
                `;
            });
            
            keywordHTML += `</div>`;
            keywordSection.innerHTML = keywordHTML;
            container.appendChild(keywordSection);
        }

        // Discard Reasons Section
        if (stats.discardReasons && Object.keys(stats.discardReasons).length > 0) {
            const discardSection = document.createElement('div');
            discardSection.style.cssText = `
                background: white;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            `;
            
            let discardHTML = `
                <h3 style="margin: 0 0 15px 0; color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px;">
                    🗑️ Discard Reasons
                </h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
            `;
            
            Object.entries(stats.discardReasons).forEach(([reason, count]) => {
                discardHTML += `
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 10px; border-radius: 5px;">
                        <div style="font-weight: bold; color: #856404;">${reason}</div>
                        <div style="color: #856404; font-size: 1.2em;">${count} events</div>
                    </div>
                `;
            });
            
            discardHTML += `</div>`;
            discardSection.innerHTML = discardHTML;
            container.appendChild(discardSection);
        }

        // Events Section (existing events display)
        if (results.events && results.events.length > 0) {
            const eventsSection = document.createElement('div');
            eventsSection.innerHTML = `
                <h3 style="margin: 20px 0 15px 0; color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px;">
                    📅 Events (${results.events.length})
                </h3>
            `;
            container.appendChild(eventsSection);

            results.events.forEach(event => {
                const eventCard = document.createElement('div');
                eventCard.style.cssText = `
                    margin: 15px 0;
                    padding: 20px;
                    border: 1px solid ${event.isBearEvent ? '#4CAF50' : '#ddd'};
                    border-left: 4px solid ${event.isBearEvent ? '#4CAF50' : '#ccc'};
                    border-radius: 5px;
                    background: ${event.isBearEvent ? '#f8fff8' : '#fff'};
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                `;

                eventCard.innerHTML = `
                    <div style="display: flex; justify-content: between; align-items: start; margin-bottom: 10px;">
                        <h4 style="margin: 0; color: #333; flex: 1;">${event.title || 'Untitled Event'}</h4>
                        ${event.isBearEvent ? '<span style="color: #4CAF50; font-size: 0.8em; font-weight: bold;">🐻 BEAR EVENT</span>' : ''}
                    </div>
                    <div style="color: #666; margin-bottom: 8px;">
                        📅 ${event.date ? new Date(event.date).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric', 
                            month: 'long',
                            day: 'numeric'
                        }) : 'Date TBD'}
                    </div>
                    <div style="color: #666; margin-bottom: 8px;">
                        📍 ${event.venue || 'Venue TBD'} ${event.city ? `• ${event.city}` : ''}
                    </div>
                    ${event.description ? `<p style="color: #555; margin: 10px 0; line-height: 1.4;">${event.description}</p>` : ''}
                    <div style="font-size: 0.85em; color: #888; margin-top: 10px;">
                        Source: ${event.source || 'Unknown'}
                        ${event.url ? ` • <a href="${event.url}" target="_blank" style="color: #007cba;">View Details</a>` : ''}
                    </div>
                `;
                container.appendChild(eventCard);
            });
        } else {
            const noEvents = document.createElement('div');
            noEvents.style.cssText = `
                text-align: center;
                padding: 40px;
                color: #666;
                background: #f8f9fa;
                border-radius: 8px;
                margin: 20px 0;
            `;
            noEvents.innerHTML = `
                <h3>No events found</h3>
                <p>Try adjusting your search criteria or check back later.</p>
            `;
            container.appendChild(noEvents);
        }

        return {
            element: container,
            text: this.generateTextSummary(results)
        };
    }
    
    generateTextSummary(results) {
        const eventCount = results.events ? results.events.length : 0;
        const bearEventCount = results.events ? results.events.filter(e => e.isBearEvent).length : 0;
        const stats = results.comprehensiveStats || {};
        
        let summary = `🐻 Bear Event Scraper Results\n`;
        summary += `================================\n\n`;
        summary += `Final Events: ${eventCount}\n`;
        summary += `Bear Events: ${bearEventCount}\n`;
        summary += `Total Found: ${stats.totals?.totalEventsFound || 0}\n`;
        summary += `Discarded: ${stats.totals?.discardedEventsTotal || 0}\n`;
        summary += `Success Rate: ${stats.overallSuccessRate || 0}%\n`;
        summary += `Bear Event Rate: ${stats.overallBearEventRate || 0}%\n\n`;
        
        if (stats.sourcePerformance) {
            summary += `Source Performance:\n`;
            summary += `------------------\n`;
            stats.sourcePerformance.forEach(source => {
                summary += `${source.source}: ${source.validEvents}/${source.totalParsed} events (${source.successRate}% success, ${source.bearEventRate}% bear)\n`;
            });
            summary += `\n`;
        }
        
        return summary;
    }

    tableToText(events) {
        let text = 'Title\t\tDate\t\tVenue\t\tCity\t\tSource\n';
        text += '='.repeat(80) + '\n';
        
        events.forEach(event => {
            text += `${event.title || 'N/A'}\t\t`;
            text += `${event.date ? new Date(event.date).toLocaleDateString() : 'N/A'}\t\t`;
            text += `${event.venue || 'N/A'}\t\t`;
            text += `${event.city || 'N/A'}\t\t`;
            text += `${event.source || 'N/A'}\n`;
        });
        
        return text;
    }

    htmlToText(results) {
        let text = 'Event Scraping Results\n';
        text += '='.repeat(30) + '\n\n';
        
        const eventCount = results.events ? results.events.length : 0;
        const bearEventCount = results.events ? 
            results.events.filter(e => e.isBearEvent).length : 0;
        
        text += `Summary:\n`;
        text += `Total Events: ${eventCount}\n`;
        text += `Bear Events: ${bearEventCount}\n`;
        text += `Source: ${results.source || 'Unknown'}\n`;
        text += `Timestamp: ${results.timestamp || 'Unknown'}\n\n`;
        
        if (results.events && results.events.length > 0) {
            text += 'Events:\n';
            text += '-'.repeat(20) + '\n';
            
            results.events.forEach((event, index) => {
                text += `${index + 1}. ${event.title}`;
                if (event.isBearEvent) text += ' 🐻 BEAR EVENT';
                text += '\n';
                text += `   Date: ${event.date ? new Date(event.date).toLocaleDateString() : 'TBD'}\n`;
                text += `   Venue: ${event.venue || 'N/A'}\n`;
                text += `   City: ${event.city || 'N/A'}\n`;
                text += `   Source: ${event.source || 'N/A'}\n`;
                if (event.description) {
                    text += `   Description: ${event.description}\n`;
                }
                text += '\n';
            });
        } else {
            text += 'No events found.\n';
        }
        
        return text;
    }
}

class ScriptableDisplayAdapter extends DisplayAdapter {
    constructor() {
        super('scriptable');
    }

    async displayResults(results, config = {}) {
        if (config.format === 'alert') {
            return this.displayAlert(results);
        } else if (config.format === 'notification') {
            return this.displayNotification(results);
        } else if (config.format === 'table') {
            return this.displayTable(results);
        } else if (config.format === 'html' || config.format === 'webview') {
            return this.displayWebView(results);
        } else {
            // Default to WebView for rich display
            return this.displayWebView(results);
        }
    }
    
    async displayWebView(results) {
        // Generate HTML content similar to web display
        const eventCount = results.events ? results.events.length : 0;
        const bearEventCount = results.events ? results.events.filter(e => e.isBearEvent).length : 0;
        const stats = results.comprehensiveStats || {};
        const processingStats = results.processingStats || {};
        
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background: #f5f5f5;
                }
                .summary {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 25px;
                    border-radius: 10px;
                    margin-bottom: 20px;
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 15px;
                    margin-top: 20px;
                }
                .stat-item {
                    text-align: center;
                }
                .stat-value {
                    font-size: 2em;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                .event-card {
                    background: white;
                    padding: 20px;
                    border-radius: 10px;
                    margin-bottom: 15px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                .event-title {
                    font-size: 1.2em;
                    font-weight: bold;
                    color: #333;
                    margin-bottom: 10px;
                }
                .event-details {
                    color: #666;
                    line-height: 1.5;
                }
                .bear-badge {
                    background: #4CAF50;
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 0.8em;
                    display: inline-block;
                    margin-left: 10px;
                }
                .no-events {
                    text-align: center;
                    padding: 40px;
                    color: #666;
                }
            </style>
        </head>
        <body>
            <div class="summary">
                <h1>🐻 Bear Event Scraper Results</h1>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value">${eventCount}</div>
                        <div>Final Events</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${bearEventCount}</div>
                        <div>Bear Events</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${results.successfulSources || 0}/${results.totalSources || 0}</div>
                        <div>Sources</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">${processingStats.duplicatesRemoved || 0}</div>
                        <div>Duplicates</div>
                    </div>
                </div>
            </div>
        `;
        
        if (results.events && results.events.length > 0) {
            html += '<div class="events">';
            results.events.forEach(event => {
                const date = event.date ? new Date(event.date).toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                }) : 'Date TBD';
                
                html += `
                    <div class="event-card">
                        <div class="event-title">
                            ${event.title}
                            ${event.isBearEvent ? '<span class="bear-badge">🐻 BEAR EVENT</span>' : ''}
                        </div>
                        <div class="event-details">
                            📅 ${date}<br>
                            📍 ${event.venue || 'Venue TBD'} - ${event.city || 'City TBD'}<br>
                            🔗 ${event.source || 'Unknown Source'}
                            ${event.description ? `<br><br>${event.description}` : ''}
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        } else {
            html += '<div class="no-events">No events found</div>';
        }
        
        html += `
            <div style="margin-top: 30px; padding: 20px; background: white; border-radius: 10px;">
                <h3>📊 Processing Statistics</h3>
                <p>Total Events Found: ${stats.totalEventsFound || processingStats.totalEventsFound || 0}</p>
                <p>Processing Success Rate: ${Math.round((results.successfulSources / results.totalSources) * 100) || 0}%</p>
                <p>Bear Event Rate: ${eventCount > 0 ? Math.round((bearEventCount / eventCount) * 100) : 0}%</p>
                <p>Past Events Filtered: ${processingStats.pastEventsFiltered || 0}</p>
            </div>
        </body>
        </html>
        `;
        
        // Create and present WebView
        const webView = new WebView();
        await webView.loadHTML(html);
        await webView.present();
        
        // Also log summary to console
        console.log(`\n📊 Final Results: ${eventCount} events (${bearEventCount} bear events) from ${results.successfulSources}/${results.totalSources} sources`);
        
        return {
            text: `Found ${eventCount} events (${bearEventCount} bear events)`,
            html: html
        };
    }

    async displayAlert(results) {
        const eventCount = results.events ? results.events.length : 0;
        const bearEventCount = results.events ? 
            results.events.filter(e => e.isBearEvent).length : 0;

        const alert = new Alert();
        alert.title = "Event Scraping Results";
        alert.message = `Found ${eventCount} events (${bearEventCount} bear events) from ${results.source || 'Unknown'}`;
        
        if (results.events && results.events.length > 0) {
            alert.addAction("View Details");
            alert.addAction("Export JSON");
        }
        alert.addAction("OK");
        
        const response = await alert.presentAlert();
        
        if (response === 0 && results.events && results.events.length > 0) {
            // Show details
            await this.displayDetailedAlert(results);
        } else if (response === 1 && results.events && results.events.length > 0) {
            // Export JSON
            await this.exportToFiles(results);
        }

        return {
            text: alert.message,
            response: response
        };
    }

    async displayDetailedAlert(results) {
        for (const event of results.events.slice(0, 5)) { // Show first 5 events
            const alert = new Alert();
            alert.title = event.title;
            alert.message = `Date: ${event.date ? new Date(event.date).toLocaleDateString() : 'TBD'}\n`;
            alert.message += `Venue: ${event.venue || 'N/A'}\n`;
            alert.message += `City: ${event.city || 'N/A'}\n`;
            alert.message += `Bear Event: ${event.isBearEvent ? 'Yes 🐻' : 'No'}\n`;
            if (event.description) {
                alert.message += `\nDescription: ${event.description}`;
            }
            alert.addAction("Next");
            alert.addAction("Done");
            
            const response = await alert.presentAlert();
            if (response === 1) break; // Done
        }
    }

    async displayNotification(results) {
        const eventCount = results.events ? results.events.length : 0;
        const bearEventCount = results.events ? 
            results.events.filter(e => e.isBearEvent).length : 0;

        const notification = new Notification();
        notification.title = "Bear Event Scraper";
        notification.body = `Found ${eventCount} events (${bearEventCount} bear events)`;
        notification.sound = "default";
        
        await notification.schedule();
        
        return {
            text: notification.body
        };
    }

    displayTable(results) {
        let output = "Event Scraping Results\n";
        output += "=".repeat(50) + "\n\n";
        
        const eventCount = results.events ? results.events.length : 0;
        const bearEventCount = results.events ? 
            results.events.filter(e => e.isBearEvent).length : 0;
        
        output += `Summary:\n`;
        output += `Total Events: ${eventCount}\n`;
        output += `Bear Events: ${bearEventCount}\n`;
        output += `Source: ${results.source || 'Unknown'}\n\n`;
        
        if (results.events && results.events.length > 0) {
            output += "Events:\n";
            output += "-".repeat(30) + "\n";
            
            results.events.forEach((event, index) => {
                output += `${index + 1}. ${event.title}`;
                if (event.isBearEvent) output += " 🐻";
                output += "\n";
                output += `   ${event.date ? new Date(event.date).toLocaleDateString() : 'TBD'} | `;
                output += `${event.venue || 'N/A'} | ${event.city || 'N/A'}\n\n`;
            });
        }
        
        console.log(output);
        return { text: output };
    }

    displayConsole(results) {
        const output = this.displayTable(results);
        return output;
    }

    async exportToFiles(results) {
        try {
            const fm = FileManager.iCloud();
            const documentsPath = fm.documentsDirectory();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `bear-events-${timestamp}.json`;
            const filepath = fm.joinPath(documentsPath, filename);
            
            fm.writeString(filepath, JSON.stringify(results, null, 2));
            
            const alert = new Alert();
            alert.title = "Export Complete";
            alert.message = `Events exported to: ${filename}`;
            alert.addAction("OK");
            await alert.presentAlert();
            
            return { filepath: filepath, filename: filename };
        } catch (error) {
            const alert = new Alert();
            alert.title = "Export Failed";
            alert.message = `Error: ${error.message}`;
            alert.addAction("OK");
            await alert.presentAlert();
            
            return { error: error.message };
        }
    }
}

// Factory function to create appropriate display adapter
function createDisplayAdapter(environment = 'auto') {
    const env = environment === 'auto' ? 
        (typeof importModule !== 'undefined' ? 'scriptable' : 'web') : 
        environment;
    
    return env === 'scriptable' ? 
        new ScriptableDisplayAdapter() : 
        new WebDisplayAdapter();
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    // Node.js/CommonJS
    module.exports = { DisplayAdapter, WebDisplayAdapter, ScriptableDisplayAdapter, createDisplayAdapter };
}

// Always export to window if it exists (for browser environment)
if (typeof window !== 'undefined') {
    window.DisplayAdapters = { DisplayAdapter, WebDisplayAdapter, ScriptableDisplayAdapter, createDisplayAdapter };
}
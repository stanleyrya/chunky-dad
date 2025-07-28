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
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        `;

        // Header
        const header = document.createElement('h2');
        header.textContent = `Event Scraping Results`;
        header.style.cssText = `
            color: #333;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
        `;
        container.appendChild(header);

        // Summary
        const summary = document.createElement('div');
        summary.style.cssText = `
            background: #f0f0f0;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        `;
        
        const eventCount = results.events ? results.events.length : 0;
        const bearEventCount = results.events ? 
            results.events.filter(e => e.isBearEvent).length : 0;
        
        summary.innerHTML = `
            <strong>Summary:</strong><br>
            Total Events: ${eventCount}<br>
            Bear Events: ${bearEventCount}<br>
            Source: ${results.source || 'Unknown'}<br>
            Timestamp: ${results.timestamp || 'Unknown'}
        `;
        container.appendChild(summary);

        // Events
        if (results.events && results.events.length > 0) {
            results.events.forEach(event => {
                const eventDiv = document.createElement('div');
                eventDiv.style.cssText = `
                    border: 1px solid ${event.isBearEvent ? '#4CAF50' : '#ddd'};
                    border-left: 4px solid ${event.isBearEvent ? '#4CAF50' : '#ccc'};
                    margin: 10px 0;
                    padding: 15px;
                    background: ${event.isBearEvent ? '#f8fff8' : '#fff'};
                `;

                eventDiv.innerHTML = `
                    <h3 style="margin: 0 0 10px 0; color: #333;">
                        ${event.title}
                        ${event.isBearEvent ? '<span style="color: #4CAF50; font-size: 0.8em;">🐻 BEAR EVENT</span>' : ''}
                    </h3>
                    <p style="margin: 5px 0; color: #666;">
                        <strong>Date:</strong> ${event.date ? new Date(event.date).toLocaleDateString() : 'TBD'}<br>
                        <strong>Venue:</strong> ${event.venue || 'N/A'}<br>
                        <strong>City:</strong> ${event.city || 'N/A'}<br>
                        <strong>Source:</strong> ${event.source || 'N/A'}
                    </p>
                    ${event.description ? `<p style="margin: 10px 0 0 0; font-style: italic;">${event.description}</p>` : ''}
                `;
                container.appendChild(eventDiv);
            });
        } else {
            const noEvents = document.createElement('p');
            noEvents.textContent = 'No events found.';
            noEvents.style.cssText = 'text-align: center; color: #666; font-style: italic;';
            container.appendChild(noEvents);
        }

        return {
            element: container,
            text: this.htmlToText(results)
        };
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
        } else {
            return this.displayConsole(results);
        }
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
} else if (typeof window !== 'undefined') {
    // Browser
    window.DisplayAdapters = { DisplayAdapter, WebDisplayAdapter, ScriptableDisplayAdapter, createDisplayAdapter };
}
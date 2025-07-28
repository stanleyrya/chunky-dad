// Input Adapters - Handle different input sources for both Scriptable and basic JS
// Provides unified interface for getting data regardless of environment

class InputAdapter {
    constructor(environment = 'auto') {
        this.environment = environment === 'auto' ? this.detectEnvironment() : environment;
        this.isScriptable = this.environment === 'scriptable';
    }

    detectEnvironment() {
        // Detect if we're running in Scriptable vs basic JS
        return typeof importModule !== 'undefined' ? 'scriptable' : 'web';
    }

    // Abstract method - implement in subclasses
    async fetchData(config) {
        throw new Error('fetchData must be implemented by subclass');
    }
}

class WebInputAdapter extends InputAdapter {
    constructor() {
        super('web');
    }

    async fetchData(config) {
        // For web environment - use fetch API or mock data for testing
        if (config.mockMode) {
            return this.getMockData(config);
        }
        
        try {
            const response = await fetch(config.url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'chunky-dad-scraper/1.0',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = await response.text();
            return {
                url: config.url,
                html: html,
                status: response.status,
                headers: Object.fromEntries(response.headers.entries()),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                url: config.url,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    getMockData(config) {
        // Return mock data for testing
        const mockData = {
            'furball': `<html><body><div class="event"><h3>Furball Dance Party</h3><time>2025-02-15</time></div></body></html>`,
            'rockbar': `<html><body><div class="event-item"><h2>Rockstrap Night</h2><span class="date">Feb 20, 2025</span></div></body></html>`,
            'sf-eagle': `<html><body><div class="event"><h4>Bear Happy Hour</h4><div class="date">March 1, 2025</div></div></body></html>`
        };
        
        const parser = config.parser || 'generic';
        return {
            url: config.url,
            html: mockData[parser] || mockData['generic'] || '<html><body><p>No events found</p></body></html>',
            status: 200,
            timestamp: new Date().toISOString(),
            mock: true
        };
    }
}

class ScriptableInputAdapter extends InputAdapter {
    constructor() {
        super('scriptable');
    }

    async fetchData(config) {
        // For Scriptable environment - use Request class
        try {
            const request = new Request(config.url);
            request.headers = {
                'User-Agent': 'chunky-dad-scraper/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            };
            
            if (config.timeout) {
                request.timeoutInterval = config.timeout / 1000; // Convert ms to seconds
            }
            
            const html = await request.loadString();
            
            return {
                url: config.url,
                html: html,
                status: request.response?.statusCode || 200,
                headers: request.response?.headers || {},
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                url: config.url,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

// Factory function to create appropriate adapter
function createInputAdapter(environment = 'auto') {
    const env = environment === 'auto' ? 
        (typeof importModule !== 'undefined' ? 'scriptable' : 'web') : 
        environment;
    
    return env === 'scriptable' ? 
        new ScriptableInputAdapter() : 
        new WebInputAdapter();
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    // Node.js/CommonJS
    module.exports = { InputAdapter, WebInputAdapter, ScriptableInputAdapter, createInputAdapter };
} else if (typeof window !== 'undefined') {
    // Browser
    window.InputAdapters = { InputAdapter, WebInputAdapter, ScriptableInputAdapter, createInputAdapter };
}
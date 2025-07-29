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
        // For web environment - use fetch API for real data
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


}

class ScriptableInputAdapter extends InputAdapter {
    constructor() {
        super('scriptable');
    }

    async fetchData(config) {
        // For Scriptable environment - use Request class
        console.log(`🌐 Fetching URL: ${config.url}`);
        try {
            const request = new Request(config.url);
            request.headers = {
                'User-Agent': 'chunky-dad-scraper/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            };
            
            if (config.timeout) {
                request.timeoutInterval = config.timeout / 1000; // Convert ms to seconds
            }
            
            console.log(`📡 Sending request with timeout: ${request.timeoutInterval}s`);
            const html = await request.loadString();
            
            console.log(`✅ Response received:
   - Status: ${request.response?.statusCode || 'unknown'}
   - Content-Type: ${request.response?.headers?.['Content-Type'] || 'unknown'}
   - HTML Length: ${html ? html.length : 0} characters
   - First 200 chars: ${html ? html.substring(0, 200).replace(/\s+/g, ' ') : 'No content'}`);
            
            if (!html || html.length === 0) {
                console.error(`❌ Empty response from ${config.url}`);
            }
            
            return {
                url: config.url,
                html: html,
                status: request.response?.statusCode || 200,
                headers: request.response?.headers || {},
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error(`❌ Request failed for ${config.url}: ${error.message}`);
            console.error(`   Stack: ${error.stack}`);
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
}

// Always export to window if it exists (for browser environment)
if (typeof window !== 'undefined') {
    window.InputAdapters = { InputAdapter, WebInputAdapter, ScriptableInputAdapter, createInputAdapter };
}
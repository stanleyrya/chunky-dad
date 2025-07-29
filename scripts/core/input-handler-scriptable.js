// Input Handler - Scriptable Environment
// Handles HTTP requests and data fetching specifically for Scriptable iOS app

class ScriptableInputHandler {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 30000,
            userAgent: config.userAgent || 'chunky-dad-scraper/1.0',
            ...config
        };
    }

    async fetchData(url, options = {}) {
        try {
            console.log(`📱 Scriptable: Fetching data from ${url}`);
            
            const request = new Request(url);
            request.method = options.method || 'GET';
            request.headers = {
                'User-Agent': this.config.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...options.headers
            };
            
            if (options.body) {
                request.body = options.body;
            }
            
            const response = await request.loadString();
            
            return {
                url: url,
                html: response,
                status: request.response ? request.response.statusCode : 200,
                headers: request.response ? request.response.headers : {},
                timestamp: new Date().toISOString(),
                success: true
            };
        } catch (error) {
            console.error(`📱 Scriptable: Failed to fetch ${url}:`, error);
            return {
                url: url,
                html: null,
                status: 0,
                headers: {},
                timestamp: new Date().toISOString(),
                success: false,
                error: error.message
            };
        }
    }

    async fetchMultipleUrls(urls, options = {}) {
        console.log(`📱 Scriptable: Fetching ${urls.length} URLs`);
        const results = [];
        
        for (const url of urls) {
            const result = await this.fetchData(url, options);
            results.push(result);
            
            // Add small delay between requests to be respectful
            if (options.delay && urls.indexOf(url) < urls.length - 1) {
                await new Promise(resolve => setTimeout(resolve, options.delay));
            }
        }
        
        return results;
    }

    // Follow links found in event data (one level deep only)
    async followEventLinks(eventData, visitedUrls = new Set()) {
        const additionalData = [];
        
        if (!eventData.additionalLinks || eventData.additionalLinks.length === 0) {
            return additionalData;
        }
        
        console.log(`📱 Following ${eventData.additionalLinks.length} additional links for event: ${eventData.title}`);
        
        for (const link of eventData.additionalLinks) {
            // Skip if we've already visited this URL
            if (visitedUrls.has(link)) {
                console.log(`📱 Skipping already visited URL: ${link}`);
                continue;
            }
            
            visitedUrls.add(link);
            const linkData = await this.fetchData(link);
            
            if (linkData.success) {
                additionalData.push({
                    ...linkData,
                    parentEvent: eventData.title,
                    linkType: 'additional'
                });
            }
        }
        
        return additionalData;
    }
}

// Export for Scriptable environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScriptableInputHandler };
} else {
    // Make available globally for Scriptable
    this.ScriptableInputHandler = ScriptableInputHandler;
}
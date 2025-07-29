// Input Handler - Web Environment
// Handles HTTP requests and data fetching specifically for web browsers

class WebInputHandler {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 30000,
            userAgent: config.userAgent || 'chunky-dad-scraper/1.0',
            corsProxy: config.corsProxy || null, // Optional CORS proxy for cross-origin requests
            ...config
        };
    }

    async fetchData(url, options = {}) {
        try {
            console.log(`🌐 Web: Fetching data from ${url}`);
            
            // Use CORS proxy if configured and needed
            const fetchUrl = this.config.corsProxy && !url.startsWith(window.location.origin) 
                ? `${this.config.corsProxy}${encodeURIComponent(url)}`
                : url;
            
            const fetchOptions = {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': this.config.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    ...options.headers
                },
                mode: 'cors',
                credentials: 'omit'
            };
            
            if (options.body) {
                fetchOptions.body = options.body;
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
            fetchOptions.signal = controller.signal;
            
            const response = await fetch(fetchUrl, fetchOptions);
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = await response.text();
            
            return {
                url: url,
                html: html,
                status: response.status,
                headers: Object.fromEntries(response.headers.entries()),
                timestamp: new Date().toISOString(),
                success: true
            };
        } catch (error) {
            console.error(`🌐 Web: Failed to fetch ${url}:`, error);
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
        console.log(`🌐 Web: Fetching ${urls.length} URLs`);
        
        // For web environment, we can use Promise.all for parallel requests
        // but we'll limit concurrency to be respectful
        const concurrency = options.concurrency || 3;
        const results = [];
        
        for (let i = 0; i < urls.length; i += concurrency) {
            const batch = urls.slice(i, i + concurrency);
            const batchPromises = batch.map(url => this.fetchData(url, options));
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Add delay between batches if specified
            if (options.delay && i + concurrency < urls.length) {
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
        
        console.log(`🌐 Following ${eventData.additionalLinks.length} additional links for event: ${eventData.title}`);
        
        // Use parallel processing for web environment
        const linkPromises = eventData.additionalLinks
            .filter(link => !visitedUrls.has(link))
            .map(async (link) => {
                visitedUrls.add(link);
                const linkData = await this.fetchData(link);
                
                if (linkData.success) {
                    return {
                        ...linkData,
                        parentEvent: eventData.title,
                        linkType: 'additional'
                    };
                }
                return null;
            });
        
        const linkResults = await Promise.all(linkPromises);
        additionalData.push(...linkResults.filter(result => result !== null));
        
        return additionalData;
    }

    // Mock data for testing when real requests fail
    getMockData(url) {
        return {
            url: url,
            html: `<html><body><h1>Mock Event</h1><p>This is mock data for testing purposes.</p></body></html>`,
            status: 200,
            headers: { 'content-type': 'text/html' },
            timestamp: new Date().toISOString(),
            success: true,
            isMock: true
        };
    }
}

// Export for web environment
if (typeof window !== 'undefined') {
    window.WebInputHandler = WebInputHandler;
} else if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebInputHandler };
}
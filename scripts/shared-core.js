// Shared Core - Pure JavaScript Business Logic
// No environment-specific code - works in both Scriptable and web environments

class SharedCore {
    constructor() {
        this.visitedUrls = new Set();
        this.bearKeywords = [
            'bear', 'bears', 'woof', 'grr', 'furry', 'hairy', 'daddy', 'cub', 
            'otter', 'leather', 'muscle bear', 'bearracuda', 'furball', 'megawoof',
            'leather bears', 'bear night', 'bear party', 'polar bear', 'grizzly'
        ];
    }

    // Pure business logic for processing events
    async processEvents(config, httpAdapter, displayAdapter, parsers) {
        const results = {
            totalEvents: 0,
            bearEvents: 0,
            calendarEvents: 0,
            errors: [],
            parserResults: []
        };

        for (const parserConfig of config.parsers) {
            try {
                const parserResult = await this.processParser(parserConfig, httpAdapter, displayAdapter, parsers);
                results.parserResults.push(parserResult);
                results.totalEvents += parserResult.totalEvents;
                results.bearEvents += parserResult.bearEvents;
                results.calendarEvents += parserResult.calendarEvents;
            } catch (error) {
                const errorMsg = `Failed to process ${parserConfig.name}: ${error.message}`;
                results.errors.push(errorMsg);
                await displayAdapter.logError('SYSTEM', errorMsg, error);
            }
        }

        return results;
    }

    async processParser(parserConfig, httpAdapter, displayAdapter, parsers) {
        const parserName = parserConfig.parser;
        const parser = parsers[parserName];
        
        if (!parser) {
            throw new Error(`Parser '${parserName}' not found`);
        }

        await displayAdapter.logInfo('SYSTEM', `Processing: ${parserConfig.name}`);
        
        const allEvents = [];
        const processedUrls = new Set();

        // Process main URLs
        for (const url of parserConfig.urls) {
            if (processedUrls.has(url)) continue;
            processedUrls.add(url);

            try {
                const htmlData = await httpAdapter.fetchData(url);
                const parseResult = parser.parseEvents(htmlData, parserConfig);
                
                if (parseResult.events) {
                    allEvents.push(...parseResult.events);
                }

                // Process additional URLs if required
                if (parserConfig.requireDetailPages && parseResult.additionalLinks) {
                    const additionalEvents = await this.processAdditionalUrls(
                        parseResult.additionalLinks, 
                        parser, 
                        parserConfig, 
                        httpAdapter, 
                        displayAdapter,
                        processedUrls
                    );
                    allEvents.push(...additionalEvents);
                }
            } catch (error) {
                await displayAdapter.logError('SYSTEM', `Failed to process URL ${url}`, error);
            }
        }

        // Filter and process events
        const futureEvents = this.filterFutureEvents(allEvents, parserConfig.daysToLookAhead);
        const bearEvents = this.filterBearEvents(futureEvents, parserConfig);
        const deduplicatedEvents = this.deduplicateEvents(bearEvents);

        // Add to calendar if not dry run
        let calendarEvents = 0;
        if (!parserConfig.dryRun && displayAdapter.addToCalendar) {
            calendarEvents = await displayAdapter.addToCalendar(deduplicatedEvents, parserConfig);
        }

        await displayAdapter.logSuccess('SYSTEM', 
            `${parserConfig.name}: ${deduplicatedEvents.length} bear events found`);

        return {
            name: parserConfig.name,
            totalEvents: allEvents.length,
            bearEvents: deduplicatedEvents.length,
            calendarEvents: calendarEvents,
            events: deduplicatedEvents
        };
    }

    async processAdditionalUrls(additionalLinks, parser, parserConfig, httpAdapter, displayAdapter, processedUrls) {
        const maxUrls = parserConfig.maxAdditionalUrls || 12;
        const urlsToProcess = additionalLinks.slice(0, maxUrls);
        const events = [];

        await displayAdapter.logInfo('SYSTEM', `Processing ${urlsToProcess.length} additional URLs`);

        for (const url of urlsToProcess) {
            if (processedUrls.has(url)) continue;
            processedUrls.add(url);

            try {
                const htmlData = await httpAdapter.fetchData(url);
                const parseResult = parser.parseEvents(htmlData, parserConfig);
                
                if (parseResult.events) {
                    events.push(...parseResult.events);
                }
            } catch (error) {
                await displayAdapter.logWarn('SYSTEM', `Failed to process additional URL: ${url}`);
            }
        }

        return events;
    }

    // Pure utility functions
    filterFutureEvents(events, daysToLookAhead = null) {
        const now = new Date();
        const cutoffDate = daysToLookAhead ? 
            new Date(now.getTime() + (daysToLookAhead * 24 * 60 * 60 * 1000)) : 
            null;

        return events.filter(event => {
            if (!event.startDate) return false;
            
            const eventDate = new Date(event.startDate);
            if (eventDate <= now) return false;
            
            if (cutoffDate && eventDate > cutoffDate) return false;
            
            return true;
        });
    }

    filterBearEvents(events, parserConfig) {
        // If alwaysBear is true, return all events
        if (parserConfig.alwaysBear) {
            return events.map(event => ({...event, isBearEvent: true}));
        }

        // Filter based on keywords and allowlist
        return events.filter(event => this.isBearEvent(event, parserConfig));
    }

    isBearEvent(event, parserConfig) {
        if (parserConfig.alwaysBear) return true;

        const searchText = `${event.title || ''} ${event.description || ''} ${event.venue || ''}`.toLowerCase();
        
        // Check allowlist first (if provided)
        if (parserConfig.allowlist && parserConfig.allowlist.length > 0) {
            const hasAllowlistKeyword = parserConfig.allowlist.some(keyword => 
                searchText.includes(keyword.toLowerCase())
            );
            if (parserConfig.requireKeywords && !hasAllowlistKeyword) {
                return false;
            }
        }

        // Check bear keywords
        return this.bearKeywords.some(keyword => searchText.includes(keyword));
    }

    deduplicateEvents(events) {
        const seen = new Map();
        const deduplicated = [];

        for (const event of events) {
            const key = this.createEventKey(event);
            
            if (!seen.has(key)) {
                seen.set(key, event);
                deduplicated.push(event);
            } else {
                // Merge with existing event if needed
                const existing = seen.get(key);
                const merged = this.mergeEvents(existing, event);
                seen.set(key, merged);
                
                // Update in deduplicated array
                const index = deduplicated.findIndex(e => this.createEventKey(e) === key);
                if (index !== -1) {
                    deduplicated[index] = merged;
                }
            }
        }

        return deduplicated;
    }

    createEventKey(event) {
        const title = (event.title || '').toLowerCase().trim();
        const date = event.startDate ? new Date(event.startDate).toDateString() : '';
        const venue = (event.venue || '').toLowerCase().trim();
        
        return `${title}|${date}|${venue}`;
    }

    mergeEvents(existing, newEvent) {
        return {
            ...existing,
            description: existing.description || newEvent.description,
            url: existing.url || newEvent.url,
            image: existing.image || newEvent.image,
            price: existing.price || newEvent.price,
            // Keep the most complete event data
        };
    }

    // URL processing utilities
    extractUrls(html, patterns, baseUrl) {
        const urls = new Set();
        
        for (const pattern of patterns) {
            const regex = new RegExp(pattern.regex, 'gi');
            let match;
            
            while ((match = regex.exec(html)) !== null && urls.size < (pattern.maxMatches || 10)) {
                const url = this.normalizeUrl(match[1], baseUrl);
                if (this.isValidUrl(url)) {
                    urls.add(url);
                }
            }
        }
        
        return Array.from(urls);
    }

    normalizeUrl(url, baseUrl) {
        if (!url) return null;
        
        // Remove HTML entities
        url = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        // Handle relative URLs
        if (url.startsWith('/')) {
            const base = new URL(baseUrl);
            return `${base.protocol}//${base.host}${url}`;
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            const base = new URL(baseUrl);
            return `${base.protocol}${url}`;
        }
        
        return url;
    }

    isValidUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // Date utilities
    parseDate(dateString) {
        if (!dateString) return null;
        
        // Try various date formats
        const formats = [
            // ISO formats
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            // Common formats
            /^\d{1,2}\/\d{1,2}\/\d{4}/,
            /^\d{4}-\d{2}-\d{2}/,
        ];
        
        for (const format of formats) {
            if (format.test(dateString)) {
                const date = new Date(dateString);
                if (!isNaN(date.getTime())) {
                    return date;
                }
            }
        }
        
        // Fallback to Date constructor
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }

    formatDateForCalendar(date) {
        if (!date) return null;
        if (typeof date === 'string') date = new Date(date);
        return date.toISOString();
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SharedCore };
} else if (typeof window !== 'undefined') {
    window.SharedCore = SharedCore;
} else {
    // Scriptable environment
    this.SharedCore = SharedCore;
}
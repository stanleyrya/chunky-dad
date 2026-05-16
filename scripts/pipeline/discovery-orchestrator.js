// ============================================================================
// DISCOVERY ORCHESTRATOR - PURE URL TRAVERSAL LOGIC
// ============================================================================
// Coordinates crawl/discovery traversal only.
// Keeps extraction and normalization responsibilities in parser/shared-core flows.
// ============================================================================

class DiscoveryOrchestrator {
    constructor(dependencies = {}) {
        this.hasProcessedUrl = dependencies.hasProcessedUrl;
        this.markProcessedUrl = dependencies.markProcessedUrl;
        this.detectParserFromUrl = dependencies.detectParserFromUrl;
        this.deduplicateUrls = dependencies.deduplicateUrls;
        this.normalizePageTypeFn = dependencies.normalizePageType;
        this.normalizeParserStageResultFn = dependencies.normalizeParserStageResult;
    }

    normalizePageType(pageType) {
        if (typeof this.normalizePageTypeFn === 'function') {
            return this.normalizePageTypeFn(pageType);
        }
        return 'unknown';
    }

    normalizeParserStageResult(parseResult) {
        if (typeof this.normalizeParserStageResultFn === 'function') {
            return this.normalizeParserStageResultFn(parseResult);
        }
        const result = parseResult && typeof parseResult === 'object' ? parseResult : {};
        return {
            ...result,
            events: Array.isArray(result.events) ? result.events : [],
            additionalLinks: Array.isArray(result.additionalLinks) ? result.additionalLinks : [],
            pageType: this.normalizePageType(result.pageType),
            url: result.url || ''
        };
    }

    validateDependencies() {
        const missing = [];
        if (typeof this.hasProcessedUrl !== 'function') missing.push('hasProcessedUrl');
        if (typeof this.markProcessedUrl !== 'function') missing.push('markProcessedUrl');
        if (typeof this.detectParserFromUrl !== 'function') missing.push('detectParserFromUrl');
        if (typeof this.deduplicateUrls !== 'function') missing.push('deduplicateUrls');
        if (missing.length > 0) {
            throw new Error(`DiscoveryOrchestrator missing required dependencies: ${missing.join(', ')}`);
        }
    }

    async discoverUrlTree({
        rootUrls,
        parsers,
        parserConfig,
        httpAdapter,
        displayAdapter,
        processedUrls,
        forcedParserName = null
    }) {
        this.validateDependencies();

        const maxDepth = parserConfig.urlDiscoveryDepth || 1;
        const edges = [];
        const allNodes = new Set(rootUrls);
        const queue = (rootUrls || []).map(url => ({ url, depth: 0, parent: null }));

        while (queue.length > 0) {
            const { url, depth, parent } = queue.shift();

            if (this.hasProcessedUrl(processedUrls, url)) continue;
            this.markProcessedUrl(processedUrls, url);

            if (parent !== null) {
                edges.push({ from: parent, to: url });
            }

            if (depth >= maxDepth) continue;

            try {
                const htmlData = await httpAdapter.fetchData(url);
                const detectedParser = forcedParserName || this.detectParserFromUrl(url) || 'generic';
                const urlParser = parsers[detectedParser];
                if (!urlParser) continue;

                const discoveryConfig = { ...parserConfig, urlDiscoveryDepth: 1 };
                const crawlResult = this.normalizeParserStageResult(
                    await Promise.resolve(urlParser.parseEvents(htmlData, discoveryConfig, null))
                );

                await displayAdapter.logInfo(`SYSTEM: [Discovery] Segment ${url} [depth ${depth}, ${crawlResult.pageType}]`);

                const deduped = this.deduplicateUrls(crawlResult.additionalLinks, processedUrls);
                for (const childUrl of deduped) {
                    allNodes.add(childUrl);
                    queue.push({ url: childUrl, depth: depth + 1, parent: url });
                }

                await displayAdapter.logInfo(`SYSTEM: [Discovery] ${url} → ${deduped.length} links (depth ${depth + 1}/${maxDepth})`);
            } catch (error) {
                await displayAdapter.logError(`SYSTEM: [Discovery] Failed to fetch ${url}: ${error.message}`);
            }
        }

        return { rootUrls, edges, allNodes: [...allNodes] };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DiscoveryOrchestrator };
} else if (typeof window !== 'undefined') {
    window.DiscoveryOrchestrator = DiscoveryOrchestrator;
} else {
    this.DiscoveryOrchestrator = DiscoveryOrchestrator;
}

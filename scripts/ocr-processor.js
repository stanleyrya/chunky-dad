// ============================================================================
// OCR PROCESSOR - IMAGE OPTICAL CHARACTER RECOGNITION AND CLASSIFICATION
// ============================================================================
// Handles OCR on downloaded images during page download phase
// ============================================================================

class OcrProcessor {
    constructor(config = {}) {
        this.config = {
            enabled: config.ocrEnabled !== false, // Default to enabled
            endpoint: config.ocrEndpoint || null,
            model: config.ocrModel || 'qwen2.5vl:3b',
            timeoutSeconds: config.ocrTimeoutSeconds || 300,
            keepAlive: config.ocrKeepAlive || '5m',
            numCtx: config.ocrNumCtx || 8192,
            numPredict: config.ocrNumPredict || 2000,
            temperature: config.ocrTemperature || 0,
            think: config.ocrThink || false,
            maxImages: config.ocrMaxImages || 10,
            maxTextChars: config.ocrMaxTextChars || 10000,
            cacheEnabled: config.ocrCacheEnabled !== false,
            cacheDir: config.ocrCacheDir || null,
            targetFields: config.ocrTargetFields || null,
            blockedFields: config.ocrBlockedFields || null,
            requireMissingFields: config.ocrRequireMissingFields || false,
            minImageDimension: config.ocrMinImageDimension || 100, // Minimum dimension in pixels
            minImageArea: config.ocrMinImageArea || 10000, // Minimum area in pixels
            loadImageAsBase64: config.loadImageAsBase64 || null, // Environment-specific method
            sendOcrRequest: config.sendOcrRequest || null, // Environment-specific method
            sendClassificationRequest: config.sendClassificationRequest || null, // Environment-specific method
            ...config
        };

        // Validate required methods
        if (!this.config.loadImageAsBase64) {
            throw new Error('OcrProcessor requires config.loadImageAsBase64 method');
        }
        if (!this.config.sendOcrRequest) {
            throw new Error('OcrProcessor requires config.sendOcrRequest method');
        }
        if (!this.config.sendClassificationRequest) {
            throw new Error('OcrProcessor requires config.sendClassificationRequest method');
        }

        // Image classification types
        this.imageClassificationTypes = {
            BACKGROUND: 'background',
            TITLE: 'title',
            AD: 'ad',
            EVENT_PROMO: 'event-promo',
            MULTI_EVENT_PROMO: 'multi-event-promo',
            UNKNOWN: 'unknown'
        };

        // Default OCR prompt
        this.defaultOcrPrompt = "Please extract all text from this image exactly as it appears. Return a JSON object with a single key 'text' containing the full extracted text, preserving line breaks as \\n. Do not add commentary.";

        // Classification prompt template
        this.classificationPromptTemplate = (imageContext) => {
            return `Please analyze this image and classify it into one of these categories:
1. background - Generic background image, no specific content
2. title - Single large text (event title, venue name, etc.)
3. ad - Advertising or promotional banner
4. event-promo - Single event promotional artwork with details
5. multi-event-promo - Multiple events listed or promoted
6. unknown - Cannot determine

Return a JSON object with:
- type: the classification type
- confidence: 0.0-1.0 confidence score
- text: any text extracted from the image
- details: brief description of what's in the image

Image context: ${imageContext || 'Unknown context'}`;
        };

        // URLs seen during current processing
        this.seenUrls = new Set();
    }

    /**
     * Extract all image URLs from HTML with metadata
     */
    extractImageUrlsFromHtml(html, baseUrl) {
        if (!html) return [];
        
        const images = [];
        const seen = new Set();

        // Match img tags
        const imgRegex = /<img\b[^>]+>/gi;
        let match;
        while ((match = imgRegex.exec(html)) !== null) {
            const tag = match[0];
            const srcMatch = tag.match(/src=["']([^"']+)["']/i);
            if (!srcMatch) continue;

            const url = this.normalizeImageUrl(srcMatch[1], baseUrl);
            if (url && !seen.has(url)) {
                seen.add(url);

                // Try to get width/height from attributes
                const widthMatch = tag.match(/\bwidth=["'](\d+)["']/i);
                const heightMatch = tag.match(/\bheight=["'](\d+)["']/i);

                images.push({
                    url,
                    width: widthMatch ? parseInt(widthMatch[1], 10) : null,
                    height: heightMatch ? parseInt(heightMatch[1], 10) : null
                });
            }
        }

        // Match background-image CSS
        const bgRegex = /background-image:\s*url\(["']?([^"'\)]+)["']?\)/gi;
        while ((match = bgRegex.exec(html)) !== null) {
            const url = this.normalizeImageUrl(match[1], baseUrl);
            if (url && !seen.has(url)) {
                seen.add(url);
                images.push({ url, width: null, height: null });
            }
        }

        // Match picture elements
        const pictureRegex = /<picture\b[^>]*>[\s\S]*?<img\b[^>]*src=["']([^"']+)["'][\s\S]*?<\/picture>/gi;
        while ((match = pictureRegex.exec(html)) !== null) {
            const url = this.normalizeImageUrl(match[1], baseUrl);
            if (url && !seen.has(url)) {
                seen.add(url);
                images.push({ url, width: null, height: null });
            }
        }

        return images;
    }

    /**
     * Normalize image URL relative to base URL
     */
    normalizeImageUrl(url, baseUrl) {
        if (!url) return null;
        
        try {
            // Handle relative URLs
            if (url.startsWith('//')) {
                // Protocol-relative URL
                if (baseUrl) {
                    try {
                        const parsed = new URL(baseUrl);
                        return `${parsed.protocol}${url}`;
                    } catch (_) {
                        return null;
                    }
                }
                return `https:${url}`;
            }
            
            if (url.startsWith('/')) {
                // Relative to domain
                if (baseUrl) {
                    try {
                        const parsed = new URL(baseUrl);
                        parsed.pathname = url;
                        return parsed.toString();
                    } catch (_) {
                        return null;
                    }
                }
                return null;
            }

            // Absolute URL
            if (/^https?:\/\//i.test(url)) {
                return url;
            }

            return null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Detect multiple resolutions of the same image
     * Returns groups of objects that appear to be different resolutions of the same image
     */
    detectImageResolutions(images) {
        if (!Array.isArray(images) || images.length === 0) return [];

        // Group images by their base image (removing resolution parameters)
        const groups = new Map();

        for (const img of images) {
            const baseImage = this.getBaseImageUrl(img.url);
            
            if (!groups.has(baseImage)) {
                groups.set(baseImage, []);
            }
            
            // Prefer resolution from URL if available, otherwise use attributes
            let resolution = this.extractImageResolution(img.url);
            if (!resolution && img.width && img.height) {
                resolution = {
                    width: img.width,
                    height: img.height,
                    area: img.width * img.height
                };
            }

            groups.get(baseImage).push({
                url: img.url,
                resolution
            });
        }

        // Return groups with multiple resolutions
        const resolutionGroups = [];
        for (const [, items] of groups) {
            if (items.length > 1) {
                resolutionGroups.push(items);
            }
        }

        return resolutionGroups;
    }

    /**
     * Get base image URL (without resolution/query parameters)
     */
    getBaseImageUrl(url) {
        if (!url) return null;

        try {
            // Special handling for Wix URLs
            if (url.includes('static.wixstatic.com/media/')) {
                // Wix format: .../media/ID~mv2.jpg/v1/fill/w_296,h_370.../filename.jpg
                // The base image ID is before the first slash after media/
                const wixMatch = url.match(/((?:https?:\/\/|\/\/)?static\.wixstatic\.com\/media\/[^/]+)/i);
                if (wixMatch) {
                    return wixMatch[1];
                }
            }

            const parsed = new URL(url);
            
            // Remove common resolution/query parameters
            const paramsToRemove = [
                'w', 'h', 'width', 'height', 
                'q', 'quality', 
                'fit', 'crop', 'resize',
                'fm', 'format', 'fjpg', 'fwebp',
                's', 'signature',
                'enc', 'encoding',
                'trim', 'padding'
            ];

            for (const param of paramsToRemove) {
                parsed.searchParams.delete(param);
            }

            // Clean up empty search string
            if (parsed.search === '?') {
                parsed.search = '';
            }

            // Strip path-based resolution for common patterns
            let base = parsed.toString();
            base = base.replace(/\/w_\d+,h_\d+[^/]*\//i, '/');
            base = base.replace(/\/fill\/w_\d+,h_\d+[^/]*\//i, '/');

            return base;
        } catch (_) {
            return url;
        }
    }

    /**
     * Extract resolution information from URL
     * Returns { width, height, area } or null if unknown
     */
    extractImageResolution(url) {
        if (!url) return null;

        // Try Wix path-based resolution first
        if (url.includes('static.wixstatic.com/media/')) {
            const wixResMatch = url.match(/\/w_(\d+),h_(\d+)/i);
            if (wixResMatch) {
                const width = parseInt(wixResMatch[1], 10);
                const height = parseInt(wixResMatch[2], 10);
                return { width, height, area: width * height };
            }
        }

        // Try to extract dimensions from URL parameters
        try {
            const parsed = new URL(url);
            
            // Check for width/height parameters
            const widthParam = parsed.searchParams.get('w') || 
                              parsed.searchParams.get('width') ||
                              parsed.searchParams.get('w_');
            
            const heightParam = parsed.searchParams.get('h') || 
                               parsed.searchParams.get('height') ||
                               parsed.searchParams.get('h_');

            if (widthParam && heightParam) {
                const width = parseInt(widthParam, 10);
                const height = parseInt(heightParam, 10);
                
                if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
                    return {
                        width,
                        height,
                        area: width * height
                    };
                }
            }

            // Try to extract from filename (e.g., image-1920x1080.jpg)
            const filename = parsed.pathname.split('/').pop();
            const resolutionMatch = filename.match(/(\d+)x(\d+)/i);
            
            if (resolutionMatch) {
                const width = parseInt(resolutionMatch[1], 10);
                const height = parseInt(resolutionMatch[2], 10);
                
                return {
                    width,
                    height,
                    area: width * height
                };
            }

            return null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Select best resolution from multiple resolutions of the same image
     * Returns the highest resolution image or all if none meet minimum requirements
     */
    selectBestResolutions(resolutionGroups) {
        if (!Array.isArray(resolutionGroups)) return [];

        const selectedUrls = [];

        for (const group of resolutionGroups) {
            if (!Array.isArray(group) || group.length === 0) continue;

            // Sort by area (largest first)
            const sorted = [...group].sort((a, b) => {
                const areaA = a.resolution ? a.resolution.area : 0;
                const areaB = b.resolution ? b.resolution.area : 0;
                return areaB - areaA;
            });

            // Select the highest resolution that meets minimum requirements
            let best = null;
            
            for (const img of sorted) {
                if (!best) {
                    best = img;
                }
                
                // If we have resolution info, use the best that meets minimum
                if (img.resolution && img.resolution.area >= this.config.minImageArea) {
                    best = img;
                    break;
                }
            }

            // If no image meets minimum requirements, use the largest
            if (!best) {
                best = sorted[0];
            }

            if (best) {
                selectedUrls.push(best.url);
            }
        }

        return selectedUrls;
    }

    /**
     * Classify an image based on OCR text
     */
    classifyImage(imageUrl, ocrText) {
        if (!ocrText) {
            return {
                type: this.imageClassificationTypes.UNKNOWN,
                confidence: 0.0,
                details: 'No text extracted'
            };
        }

        const textLower = ocrText.toLowerCase();
        
        // Classification rules with confidence scores
        const classifications = [
            {
                type: this.imageClassificationTypes.BACKGROUND,
                confidence: 0.9,
                matches: ['background', 'pattern', 'texture', 'gradient', 'blur'],
                minConfidence: 0.7
            },
            {
                type: this.imageClassificationTypes.AD,
                confidence: 0.85,
                matches: ['buy', 'sale', 'offer', 'deal', 'discount', 'free', 'limited time', 'act now'],
                minConfidence: 0.6
            },
            {
                type: this.imageClassificationTypes.TITLE,
                confidence: 0.95,
                matches: [],
                minConfidence: 0.8,
                condition: () => {
                    // Single line or very short text with large font indicators
                    const lines = ocrText.split('\n').filter(line => line.trim().length > 0);
                    return lines.length <= 2 && ocrText.length < 200;
                }
            },
            {
                type: this.imageClassificationTypes.EVENT_PROMO,
                confidence: 0.9,
                matches: ['event', 'show', 'performance', 'concert', 'gala', 'benefit'],
                minConfidence: 0.7,
                condition: () => {
                    // Has date/time indicators or single event details
                    const datePatterns = [/\d{1,2}\/\d{1,2}/, /\d{1,2}:\d{2}/, /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i];
                    return datePatterns.some(pattern => pattern.test(textLower));
                }
            },
            {
                type: this.imageClassificationTypes.MULTI_EVENT_PROMO,
                confidence: 0.85,
                matches: ['lineup', 'fest', 'festival', 'series', 'package', 'various'],
                minConfidence: 0.7,
                condition: () => {
                    // Multiple date/time indicators or multiple event names
                    const dateMatches = ocrText.match(/\d{1,2}\/\d{1,2}/g) || [];
                    return dateMatches.length >= 2;
                }
            }
        ];

        let bestClassification = {
            type: this.imageClassificationTypes.UNKNOWN,
            confidence: 0.0,
            details: 'No matches found'
        };

        for (const classification of classifications) {
            let matchCount = 0;
            
            for (const keyword of classification.matches) {
                if (textLower.includes(keyword)) {
                    matchCount++;
                }
            }

            let confidence = matchCount > 0 
                ? Math.min(classification.confidence, 0.99) 
                : 0.0;

            // Apply condition if present
            if (classification.condition) {
                if (classification.condition()) {
                    confidence = Math.max(confidence, classification.minConfidence);
                } else {
                    confidence = 0.0;
                }
            } else {
                confidence = matchCount > 0 
                    ? Math.min(classification.confidence, 0.99) 
                    : 0.0;
            }

            if (confidence > bestClassification.confidence) {
                bestClassification = {
                    type: classification.type,
                    confidence,
                    details: `Found ${matchCount} keyword matches`
                };
            }
        }

        return bestClassification;
    }

    /**
     * Build OCR request configuration
     */
    buildOcrRequestConfig(imageUrl) {
        return {
            endpoint: this.config.endpoint,
            model: this.config.model,
            prompt: this.defaultOcrPrompt,
            timeoutSeconds: this.config.timeoutSeconds,
            keepAlive: this.config.keepAlive,
            numCtx: this.config.numCtx,
            numPredict: this.config.numPredict,
            temperature: this.config.temperature,
            think: this.config.think,
            cacheEnabled: this.config.cacheEnabled,
            cacheDir: this.config.cacheDir,
            imageUrl
        };
    }

    /**
     * Build image classification request configuration
     */
    buildClassificationRequestConfig(imageUrl, imageContext) {
        return {
            endpoint: this.config.endpoint,
            model: this.config.model,
            prompt: this.classificationPromptTemplate(imageContext),
            timeoutSeconds: this.config.timeoutSeconds,
            keepAlive: this.config.keepAlive,
            numCtx: this.config.numCtx,
            numPredict: this.config.numPredict,
            temperature: this.config.temperature,
            think: this.config.think,
            cacheEnabled: this.config.cacheEnabled,
            cacheDir: this.config.cacheDir,
            imageUrl
        };
    }

    /**
     * Load image as base64 (implementation depends on environment)
     */
    async loadImageAsBase64(imageUrl) {
        if (!this.config.loadImageAsBase64) {
            throw new Error('loadImageAsBase64 method not provided in config');
        }
        return await this.config.loadImageAsBase64(imageUrl);
    }

    /**
     * Send OCR request (implementation depends on environment)
     */
    async sendOcrRequest(ocrConfig) {
        if (!this.config.sendOcrRequest) {
            throw new Error('sendOcrRequest method not provided in config');
        }
        return await this.config.sendOcrRequest(ocrConfig);
    }

    /**
     * Send classification request (implementation depends on environment)
     */
    async sendClassificationRequest(classificationConfig) {
        if (!this.config.sendClassificationRequest) {
            throw new Error('sendClassificationRequest method not provided in config');
        }
        return await this.config.sendClassificationRequest(classificationConfig);
    }

    /**
     * Parse OCR response
     */
    parseOcrResponse(rawText) {
        if (!rawText) return null;

        // If already an object, process it
        if (typeof rawText === 'object') {
            if (rawText.response && typeof rawText.response === 'string') {
                return this.parseOcrResponse(rawText.response);
            }
            if (typeof rawText.text === 'string') {
                return rawText.text.trim();
            }
            return null;
        }

        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(rawText);
            
            // If the response is the whole Ollama response object
            if (parsed && typeof parsed.response === 'string') {
                return this.parseOcrResponse(parsed.response);
            }

            if (parsed && typeof parsed.text === 'string') {
                return parsed.text.trim();
            }
            
            if (typeof parsed === 'string') {
                return parsed.trim();
            }
            
            return null;
        } catch (_) {
            // Not JSON, return as plain text
            return rawText.trim();
        }
    }

    /**
     * Parse classification response
     */
    parseClassificationResponse(rawText) {
        if (!rawText) return null;

        // If already an object, process it
        if (typeof rawText === 'object') {
            if (rawText.response && typeof rawText.response === 'string') {
                return this.parseClassificationResponse(rawText.response);
            }
            if (typeof rawText.type === 'string') {
                return {
                    type: rawText.type,
                    confidence: typeof rawText.confidence === 'number' ? rawText.confidence : 0.0,
                    text: typeof rawText.text === 'string' ? rawText.text : '',
                    details: typeof rawText.details === 'string' ? rawText.details : ''
                };
            }
            return null;
        }

        try {
            // Try to parse as JSON
            const parsed = JSON.parse(rawText);
            
            // If the response is the whole Ollama response object
            if (parsed && typeof parsed.response === 'string') {
                return this.parseClassificationResponse(parsed.response);
            }

            if (parsed && typeof parsed.type === 'string') {
                return {
                    type: parsed.type,
                    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.0,
                    text: typeof parsed.text === 'string' ? parsed.text : '',
                    details: typeof parsed.details === 'string' ? parsed.details : ''
                };
            }
            
            return null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Process a single image with OCR and classification
     */
    async processSingleImage(imageUrl) {
        // Check if we've reached max images
        if (this.seenUrls.size >= this.config.maxImages) {
            return null;
        }

        // Check if we've already processed this URL
        if (this.seenUrls.has(imageUrl)) {
            return null;
        }

        this.seenUrls.add(imageUrl);

        // Build OCR request config
        const ocrConfig = this.buildOcrRequestConfig(imageUrl);
        
        // Send OCR request
        const ocrResult = await this.sendOcrRequest(ocrConfig);
        
        if (!ocrResult) {
            return {
                imageUrl,
                ocrText: null,
                classification: null,
                cached: false
            };
        }

        // Parse OCR response
        const ocrText = this.parseOcrResponse(ocrResult.response || ocrResult.text || '');
        
        // Build classification request config
        const classificationConfig = this.buildClassificationRequestConfig(
            imageUrl,
            `Image URL: ${imageUrl}`
        );
        
        // Send classification request
        const classificationResult = await this.sendClassificationRequest(classificationConfig);
        
        // Parse classification response
        let classification = null;
        if (classificationResult) {
            classification = this.parseClassificationResponse(
                classificationResult.response || classificationResult.text || ''
            );
        }

        // If classification failed, use heuristic classification
        if (!classification && ocrText) {
            classification = this.classifyImage(imageUrl, ocrText);
        }

        return {
            imageUrl,
            ocrText: ocrText || '',
            classification: classification || {
                type: this.imageClassificationTypes.UNKNOWN,
                confidence: 0.0,
                details: 'Classification unavailable'
            },
            cached: ocrResult.cached || false
        };
    }

    /**
     * Process all images from a page
     */
    async processPageImages(html, baseUrl) {
        // Extract images with metadata
        const images = this.extractImageUrlsFromHtml(html, baseUrl);
        
        // Detect resolution groups
        const resolutionGroups = this.detectImageResolutions(images);
        
        // Select best resolutions for grouped images
        const bestGroupedUrls = this.selectBestResolutions(resolutionGroups);
        const bestGroupedSet = new Set(bestGroupedUrls);

        // Find URLs that were in a group but NOT the best
        const rejectedUrls = new Set();
        for (const group of resolutionGroups) {
            for (const img of group) {
                if (!bestGroupedSet.has(img.url)) {
                    rejectedUrls.add(img.url);
                }
            }
        }

        // Final list of URLs to process (all non-grouped + best from each group)
        const urlsToProcess = images
            .filter(img => {
                // If this image was rejected in resolution selection, skip it
                if (rejectedUrls.has(img.url)) return false;

                // Enforce minimum size if known
                if (img.width && img.height) {
                    return img.width >= this.config.minImageDimension &&
                           img.height >= this.config.minImageDimension &&
                           (img.width * img.height) >= this.config.minImageArea;
                }

                // Heuristic for unknown sizes - skip likely icons
                const url = img.url.toLowerCase();
                if (url.includes('icon') || url.includes('favicon')) return false;

                return true;
            })
            .map(img => img.url);

        // Process each image
        const results = [];
        
        for (const imageUrl of urlsToProcess) {
            const result = await this.processSingleImage(imageUrl);
            
            if (result) {
                results.push(result);
            }
        }

        // Build summary
        const summary = this.buildOcrSummary(results);

        return {
            images: results,
            summary
        };
    }

    /**
     * Build OCR summary
     */
    buildOcrSummary(results) {
        if (!Array.isArray(results) || results.length === 0) {
            return {
                totalImages: 0,
                imagesWithText: 0,
                totalTextChars: 0,
                classifications: {},
                typesFound: []
            };
        }

        const summary = {
            totalImages: results.length,
            imagesWithText: 0,
            totalTextChars: 0,
            classifications: {},
            typesFound: []
        };

        for (const result of results) {
            if (result.ocrText && result.ocrText.length > 0) {
                summary.imagesWithText++;
                summary.totalTextChars += result.ocrText.length;
            }

            if (result.classification) {
                const type = result.classification.type;
                summary.classifications[type] = (summary.classifications[type] || 0) + 1;
                
                if (!summary.typesFound.includes(type)) {
                    summary.typesFound.push(type);
                }
            }
        }

        return summary;
    }

    /**
     * Clean up seen URLs set (for new page processing)
     */
    reset() {
        this.seenUrls.clear();
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OcrProcessor };
} else if (typeof window !== 'undefined') {
    window.OcrProcessor = OcrProcessor;
} else {
    // Scriptable environment
    this.OcrProcessor = OcrProcessor;
}
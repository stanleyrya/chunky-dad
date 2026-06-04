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
     * Extract all image URLs from HTML
     */
    extractImageUrlsFromHtml(html, baseUrl) {
        if (!html) return [];
        
        const imageUrls = [];
        const seen = new Set();

        // Match img tags
        const imgRegex = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = imgRegex.exec(html)) !== null) {
            const url = this.normalizeImageUrl(match[1], baseUrl);
            if (url && !seen.has(url)) {
                seen.add(url);
                imageUrls.push(url);
            }
        }

        // Match background-image CSS
        const bgRegex = /background-image:\s*url\(["']?([^"'\)]+)["']?\)/gi;
        while ((match = bgRegex.exec(html)) !== null) {
            const url = this.normalizeImageUrl(match[1], baseUrl);
            if (url && !seen.has(url)) {
                seen.add(url);
                imageUrls.push(url);
            }
        }

        // Match picture elements
        const pictureRegex = /<picture\b[^>]*>[\s\S]*?<img\b[^>]*src=["']([^"']+)["'][\s\S]*?<\/picture>/gi;
        while ((match = pictureRegex.exec(html)) !== null) {
            const url = this.normalizeImageUrl(match[1], baseUrl);
            if (url && !seen.has(url)) {
                seen.add(url);
                imageUrls.push(url);
            }
        }

        return imageUrls;
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
     * Returns groups of URLs that appear to be different resolutions of the same image
     */
    detectImageResolutions(imageUrls) {
        if (!Array.isArray(imageUrls) || imageUrls.length === 0) return [];

        // Group URLs by their base image (removing resolution parameters)
        const groups = new Map();

        for (const url of imageUrls) {
            const baseImage = this.getBaseImageUrl(url);
            
            if (!groups.has(baseImage)) {
                groups.set(baseImage, []);
            }
            
            groups.get(baseImage).push({
                url,
                resolution: this.extractImageResolution(url)
            });
        }

        // Return groups with multiple resolutions
        const resolutionGroups = [];
        for (const [, urls] of groups) {
            if (urls.length > 1) {
                resolutionGroups.push(urls);
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

            return parsed.toString();
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

        // Try to extract dimensions from URL parameters
        try {
            const parsed = new URL(url);
            
            // Check for width/height parameters
            const widthParam = parsed.searchParams.get('w') || 
                              parsed.searchParams.get('width') ||
                              parsed.searchParams.get('w_') ||
                              parsed.searchParams.get('w_296'); // Example: w_296
            
            const heightParam = parsed.searchParams.get('h') || 
                               parsed.searchParams.get('height') ||
                               parsed.searchParams.get('h_') ||
                               parsed.searchParams.get('h_370'); // Example: h_370

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

        try {
            // Try to parse as JSON first
            const parsed = JSON.parse(rawText);
            
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

        try {
            // Try to parse as JSON
            const parsed = JSON.parse(rawText);
            
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
        // Extract image URLs
        let imageUrls = this.extractImageUrlsFromHtml(html, baseUrl);
        
        // Detect resolution groups
        const resolutionGroups = this.detectImageResolutions(imageUrls);
        
        // Select best resolutions
        if (resolutionGroups.length > 0) {
            imageUrls = this.selectBestResolutions(resolutionGroups);
        }

        // Process each image
        const results = [];
        
        for (const imageUrl of imageUrls) {
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
// ============================================================================
// AI WEB PARSER
// ============================================================================
// Handles AI extraction + event normalization for pages that don't parse well
// with deterministic selectors.
// ============================================================================

const ImportedEventSchema = (() => {
    try {
        if (typeof importModule === 'function') {
            const schemaModule = importModule('event-schema');
            if (schemaModule && schemaModule.EventSchema) {
                return schemaModule.EventSchema;
            }
        }
    } catch (_) {}
    try {
        if (typeof require === 'function') {
            const schemaModule = require('../event-schema');
            if (schemaModule && schemaModule.EventSchema) {
                return schemaModule.EventSchema;
            }
        }
    } catch (_) {}
    return null;
})();

class AiWebParser {
    constructor(config = {}) {
        this.config = {
            source: 'ai-web',
            maxAdditionalUrls: 15,
            ...config
        };
        this.cachedEventSchemaPromptFields = [];
        this.cachedEventSchemaPromptFieldDescriptions = new Map();
        this.eventSchemaPromptFieldsLoaded = false;
    }

    async parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const html = htmlData && htmlData.html ? htmlData.html : '';
            const sourceUrl = htmlData && htmlData.url ? htmlData.url : '';

            if (parserConfig.urlDiscoveryDepth > 0) {
                const additionalLinks = this.extractAdditionalUrls(html, sourceUrl, parserConfig);
                console.log(`🤖 AI Web: Discovery mode found ${additionalLinks.length} additional links`);
                return {
                    events: [],
                    additionalLinks: additionalLinks,
                    source: this.config.source,
                    url: sourceUrl
                };
            }

            const aiEvent = await this.getAiEvent(htmlData, parserConfig, cityConfig);
            if (!aiEvent) {
                return this.buildEmptyResult(htmlData);
            }

            const event = this.normalizeAiEvent(aiEvent, parserConfig);
            if (!event || !event.title || !event.startDate) {
                console.warn('🤖 AI Web: AI output missing required title/startDate after normalization');
                return this.buildEmptyResult(htmlData);
            }

            return {
                events: [event],
                additionalLinks: [],
                source: this.config.source,
                url: htmlData && htmlData.url ? htmlData.url : ''
            };
        } catch (error) {
            console.warn(`🤖 AI Web: Failed to parse AI event: ${error}`);
            return this.buildEmptyResult(htmlData);
        }
    }

    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();

        try {
            const configuredPatterns = parserConfig.urlPatterns;
            const patterns = Array.isArray(configuredPatterns) && configuredPatterns.length > 0
                ? configuredPatterns
                : [{ regex: 'href=["\']([^"\']+)["\']' }];

            for (const pattern of patterns) {
                const regex = new RegExp(pattern.regex, 'gi');
                let match;
                let matchCount = 0;

                while ((match = regex.exec(html)) !== null && matchCount < (pattern.maxMatches || 10)) {
                    const url = this.normalizeUrl(match[1], sourceUrl);
                    if (this.isValidEventUrl(url, sourceUrl)) {
                        urls.add(url);
                        matchCount++;
                    }
                }
            }
        } catch (error) {
            console.warn(`🤖 AI Web: Error extracting additional URLs: ${error}`);
        }

        const parserMaxAdditionalUrls = Number(parserConfig.maxAdditionalUrls);
        const maxAdditionalUrls = Number.isFinite(parserMaxAdditionalUrls)
            ? parserMaxAdditionalUrls
            : Number(this.config.maxAdditionalUrls);
        if (Number.isFinite(maxAdditionalUrls) && maxAdditionalUrls >= 0) {
            return Array.from(urls).slice(0, maxAdditionalUrls);
        }
        return Array.from(urls);
    }

    isValidEventUrl(url, sourceUrl) {
        if (!url || typeof url !== 'string') return false;

        try {
            const parsedUrl = new URL(url);
            if (!/^https?:$/.test(parsedUrl.protocol)) return false;
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            
            const urlMatch = url.match(urlPattern);
            if (!urlMatch) return false;
            const lowerPath = (parsedUrl.pathname || '').toLowerCase();
            const staticAssetExtensions = [
                '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tif', '.tiff',
                '.css', '.js', '.mjs', '.map', '.json', '.xml', '.txt', '.pdf', '.zip', '.gz', '.tgz',
                '.mp3', '.m4a', '.wav', '.mp4', '.webm', '.mov', '.avi', '.woff', '.woff2', '.ttf'
            ];
            if (staticAssetExtensions.some(ext => lowerPath.endsWith(ext))) return false;
            const staticAssetPathHints = ['/touch_icons/', '/images/', '/image/', '/img/', '/assets/', '/static/'];
            if (staticAssetPathHints.some(segment => lowerPath.includes(segment))) return false;

            const invalidUrlPatterns = [
                '/admin', '/login', '/wp-admin', '/wp-login', '/user/', '/profile/',
                '#', 'javascript:', 'mailto:', 'tel:', 'sms:',
                'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com'
            ];

            if (invalidUrlPatterns.some(invalid => url.toLowerCase().includes(invalid))) return false;
            return true;
        } catch (error) {
            return false;
        }
    }

    normalizeUrl(url, baseUrl) {
        if (!url) return null;

        url = url.replace(/&amp;/g, '&');

        if (url.startsWith('/')) {
            const urlPattern = /^(https?:)\/\/([^\/]+)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol, host] = match;
                return `${protocol}//${host}${url}`;
            }
        }

        if (url.startsWith('//')) {
            const urlPattern = /^(https?:)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol] = match;
                return `${protocol}${url}`;
            }
        }

        if (url.startsWith('#')) {
            return null;
        }

        return url;
    }

    buildEmptyResult(htmlData) {
        return {
            events: [],
            additionalLinks: [],
            source: this.config.source,
            url: htmlData && htmlData.url ? htmlData.url : ''
        };
    }

    async getAiEvent(htmlData, parserConfig, cityConfig) {
        if (!htmlData || typeof htmlData !== 'object') return null;
        if (htmlData.aiEvent && typeof htmlData.aiEvent === 'object') return htmlData.aiEvent;
        if (htmlData.aiExtraction && typeof htmlData.aiExtraction.event === 'object') {
            return htmlData.aiExtraction.event;
        }
        const aiConfig = this.getAiConfig(parserConfig);
        if (!aiConfig.enabled || !htmlData.html) {
            return null;
        }
        const promptFields = this.getAiPromptFields(aiConfig, parserConfig);
        if (promptFields.length === 0) {
            console.warn('🤖 AI Web: EventSchema.AI_PROMPT_FIELDS unavailable - skipping extraction');
            return null;
        }
        console.log(`🤖 AI Web: Running AI extraction for ${htmlData.url || 'unknown URL'} (${promptFields.length} field${promptFields.length === 1 ? '' : 's'})`);
        return await this.extractEventWithBatchedAi(htmlData, aiConfig, cityConfig, parserConfig, promptFields);
    }

    getAiConfig(parserConfig = {}) {
        const aiConfig = parserConfig && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        return {
            enabled: aiConfig.enabled !== false,
            endpoint: String(aiConfig.endpoint || 'http://desktop.taila7523c.ts.net:11434/api/generate'),
            model: String(aiConfig.model || 'qwen3.5:4b'),
            maxHtmlChars: Number.isFinite(Number(aiConfig.maxHtmlChars)) ? Number(aiConfig.maxHtmlChars) : 6000,
            numCtx: Number.isFinite(Number(aiConfig.numCtx)) ? Number(aiConfig.numCtx) : 2048,
            numPredict: Number.isFinite(Number(aiConfig.numPredict)) ? Number(aiConfig.numPredict) : 50,
            temperature: Number.isFinite(Number(aiConfig.temperature)) ? Number(aiConfig.temperature) : 0,
            think: Object.prototype.hasOwnProperty.call(aiConfig, 'think') ? Boolean(aiConfig.think) : false,
            fieldBatchSize: Number.isFinite(Number(aiConfig.fieldBatchSize)) ? Math.max(1, Number(aiConfig.fieldBatchSize)) : 4,
            timeoutSeconds: Number.isFinite(Number(aiConfig.timeoutSeconds)) ? Number(aiConfig.timeoutSeconds) : 120,
            keepAlive: Object.prototype.hasOwnProperty.call(aiConfig, 'keepAlive') ? String(aiConfig.keepAlive) : '5m'
        };
    }

    cleanHtml(html) {
        if (!html) return '';
        // Cap raw HTML before regex passes to avoid pathological inputs
        let text = String(html).slice(0, 500000);
        // Remove script and style blocks (and their content)
        text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ');
        text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ');
        // Remove HTML comments
        text = text.replace(/<!--[\s\S]*?-->/g, ' ');
        // Remove nav/header/footer/aside/noscript blocks (high-noise, low-signal)
        text = text.replace(/<(nav|header|footer|aside|noscript)\b[^>]*>[\s\S]*?<\/\1[^>]*>/gi, ' ');
        // Remove remaining HTML tags
        text = text.replace(/<[^>]+>/g, ' ');
        // Collapse all whitespace into single spaces
        text = text.replace(/\s+/g, ' ').trim();
        return text;
    }

    getEventSchema() {
        const localEventSchema = typeof EventSchema !== 'undefined' ? EventSchema : null;
        const globalEventSchema = typeof globalThis !== 'undefined' ? (globalThis.EventSchema || null) : null;
        return localEventSchema || globalEventSchema || ImportedEventSchema || null;
    }

    normalizePromptFieldName(field) {
        const normalized = String(field || '').trim().toLowerCase();
        const schema = this.getEventSchema();
        if (!schema || typeof schema.canonicalizeEventKey !== 'function') {
            return normalized;
        }
        const canonical = schema.canonicalizeEventKey(normalized);
        return String(canonical || normalized).toLowerCase();
    }

    getEventSchemaPromptFields() {
        if (this.eventSchemaPromptFieldsLoaded) {
            return this.cachedEventSchemaPromptFields;
        }
        const schema = this.getEventSchema();
        if (!schema || !Array.isArray(schema.AI_PROMPT_FIELDS)) {
            this.cachedEventSchemaPromptFields = [];
            this.cachedEventSchemaPromptFieldDescriptions = new Map();
            this.eventSchemaPromptFieldsLoaded = true;
            console.warn('🤖 AI Web: EventSchema.AI_PROMPT_FIELDS unavailable - extraction fields will be empty');
            return this.cachedEventSchemaPromptFields;
        }
        this.cachedEventSchemaPromptFields = schema.AI_PROMPT_FIELDS
            .filter(field => field && typeof field.param === 'string' && typeof field.desc === 'string')
            .map(field => {
                const promptFieldName = String(field.param).trim();
                return {
                    promptFieldName,
                    normalizedName: this.normalizePromptFieldName(promptFieldName),
                    description: field.desc.trim()
                };
            });
        this.cachedEventSchemaPromptFieldDescriptions = new Map(
            this.cachedEventSchemaPromptFields.map(field => [field.normalizedName, field.description])
        );
        this.eventSchemaPromptFieldsLoaded = true;
        return this.cachedEventSchemaPromptFields;
    }

    getEventSchemaPromptFieldDescription(fieldName) {
        if (!this.eventSchemaPromptFieldsLoaded) {
            this.getEventSchemaPromptFields();
        }
        return this.cachedEventSchemaPromptFieldDescriptions.get(fieldName) || null;
    }

    getDefaultExtractionFields() {
        return this.getEventSchemaPromptFields().map(field => field.promptFieldName);
    }

    getAiPromptFields(aiConfig, parserConfig = {}) {
        const priorities = parserConfig && parserConfig.fieldPriorities && typeof parserConfig.fieldPriorities === 'object'
            ? parserConfig.fieldPriorities
            : {};
        const metadata = parserConfig && parserConfig.metadata && typeof parserConfig.metadata === 'object'
            ? parserConfig.metadata
            : {};
        const selected = Object.keys(priorities).filter(field => {
            const rule = priorities[field];
            if (!rule || !Array.isArray(rule.priority)) return false;
            if (!rule.priority.includes('ai-web')) return false;
            if (rule.priority.includes('static')) return false;
            if (Object.prototype.hasOwnProperty.call(metadata, field)) return false;
            return true;
        });
        if (selected.length > 0) {
            return selected;
        }
        return this.getDefaultExtractionFields();
    }

    getFieldContext(field, cityConfig) {
        const normalized = this.normalizePromptFieldName(field);
        const schemaDescription = this.getEventSchemaPromptFieldDescription(normalized);
        let description = schemaDescription || 'Event field';
        if (normalized === 'city' && cityConfig && typeof cityConfig === 'object') {
            const cityKeys = this.getCityKeys(cityConfig);
            if (cityKeys.length > 0) {
                description += `. Must be one of: ${cityKeys.join(', ')}`;
            }
        }
        return description;
    }

    getCityKeys(cityConfig) {
        if (!cityConfig || typeof cityConfig !== 'object') return [];
        const candidateMap = cityConfig.cities && typeof cityConfig.cities === 'object'
            ? cityConfig.cities
            : cityConfig;
        const keys = Object.keys(candidateMap);
        if (keys.length === 0) return [];
        const inferredKeys = keys.filter(key => {
            const value = candidateMap[key];
            return value && typeof value === 'object' && (
                'timezone' in value ||
                'state' in value ||
                'country' in value ||
                'aliases' in value ||
                'label' in value
            );
        });
        return inferredKeys.length > 0 ? inferredKeys : keys;
    }

    buildFieldContextText(fields, cityConfig) {
        return fields.map(field => `- ${field}: ${this.getFieldContext(field, cityConfig)}`).join('\n');
    }

    buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields) {
        const htmlCharLimit = Math.max(500, Number(aiConfig.maxHtmlChars));
        const snippet = this.cleanHtml(htmlData.html || '').slice(0, htmlCharLimit);
        const fieldContext = this.buildFieldContextText(fields, cityConfig);
        return `Extract exactly one event from this page and return ONLY valid JSON.
Preferred keys:
${fieldContext}
Rules:
- Return a single JSON object only
- Return only keys from the Preferred keys list
- Use ISO datetime for startDate/endDate when possible
- Omit unknown fields

URL: ${htmlData.url || ''}
HTML:
${snippet}`;
    }

    buildJsonRepairPrompt(rawResponse, aiConfig, cityConfig, parserConfig, fields) {
        const fieldContext = this.buildFieldContextText(fields, cityConfig);
        return `Convert this text into one strict JSON object for an event.
Preferred keys:
${fieldContext}
Rules:
- JSON object only
- Use only the preferred keys
- No markdown
- No commentary
- Omit unknown fields

TEXT:
${String(rawResponse || '')}`;
    }

    getAiFieldBatches(fields, batchSize) {
        const allFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
        if (allFields.length === 0) return [];
        const normalizedRequired = new Set(['title', 'name', 'startdate', 'start']);
        const required = [];
        const optional = [];
        for (const field of allFields) {
            const normalized = String(field).toLowerCase().replace(/[\s_-]/g, '');
            if (normalizedRequired.has(normalized)) {
                required.push(field);
            } else {
                optional.push(field);
            }
        }
        const ordered = [];
        const seen = new Set();
        for (const field of [...required, ...optional]) {
            if (!seen.has(field)) {
                seen.add(field);
                ordered.push(field);
            }
        }
        const safeBatchSize = Math.max(1, Number(batchSize) || 1);
        const batches = [];
        for (let i = 0; i < ordered.length; i += safeBatchSize) {
            batches.push(ordered.slice(i, i + safeBatchSize));
        }
        return batches;
    }

    mergeAiPartialEvent(target, partial) {
        if (!partial || typeof partial !== 'object') return target;
        const merged = target && typeof target === 'object' ? { ...target } : {};
        for (const [key, value] of Object.entries(partial)) {
            if (value === null || value === undefined) continue;
            const text = typeof value === 'string' ? value.trim() : value;
            if (text === '') continue;
            if (!Object.prototype.hasOwnProperty.call(merged, key) || merged[key] === null || merged[key] === undefined || String(merged[key]).trim() === '') {
                merged[key] = value;
            }
        }
        return merged;
    }

    async extractEventWithTwoPassAi(htmlData, aiConfig, cityConfig, parserConfig, fields, batchIndex = 1, batchTotal = 1) {
        const passSuffix = batchTotal > 1 ? ` batch ${batchIndex}/${batchTotal}` : '';
        const extractPrompt = this.buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields);
        const firstPass = await this.callAiGenerate(aiConfig, extractPrompt, 'extraction');
        if (!firstPass) return null;
        const parsedFirstPass = this.parseAiEventResponse(firstPass);
        if (parsedFirstPass) {
            console.log(`🤖 AI Web: Extraction pass${passSuffix} returned parseable JSON`);
            return parsedFirstPass;
        }
        console.warn(`🤖 AI Web: Extraction pass${passSuffix} was not parseable JSON; running repair pass`);
        const repairPrompt = this.buildJsonRepairPrompt(firstPass, aiConfig, cityConfig, parserConfig, fields);
        const secondPass = await this.callAiGenerate(aiConfig, repairPrompt, 'repair');
        if (!secondPass) return null;
        const parsedSecondPass = this.parseAiEventResponse(secondPass);
        if (parsedSecondPass) {
            console.log(`🤖 AI Web: Repair pass${passSuffix} returned parseable JSON`);
            return parsedSecondPass;
        }
        console.warn(`🤖 AI Web: Repair pass${passSuffix} output was still not parseable JSON`);
        return null;
    }

    async extractEventWithBatchedAi(htmlData, aiConfig, cityConfig, parserConfig, promptFields) {
        const fieldBatches = this.getAiFieldBatches(promptFields, aiConfig.fieldBatchSize);
        if (fieldBatches.length === 0) return null;
        let mergedAiEvent = {};
        for (let batchIndex = 0; batchIndex < fieldBatches.length; batchIndex++) {
            const batchFields = fieldBatches[batchIndex];
            const partialEvent = await this.extractEventWithTwoPassAi(
                htmlData,
                aiConfig,
                cityConfig,
                parserConfig,
                batchFields,
                batchIndex + 1,
                fieldBatches.length
            );
            if (partialEvent && typeof partialEvent === 'object') {
                mergedAiEvent = this.mergeAiPartialEvent(mergedAiEvent, partialEvent);
            }
        }
        return Object.keys(mergedAiEvent).length > 0 ? mergedAiEvent : null;
    }

    async callAiGenerate(aiConfig, prompt, passLabel) {
        if (!prompt) return null;
        const label = passLabel ? ` (${passLabel} pass)` : '';
        const promptChars = prompt.length;
        const payload = {
            model: aiConfig.model,
            prompt,
            stream: false,
            think: aiConfig.think,
            keep_alive: aiConfig.keepAlive,
            options: {
                num_ctx: aiConfig.numCtx,
                num_predict: aiConfig.numPredict,
                temperature: aiConfig.temperature
            }
        };
        console.log(`🤖 AI Web: Sending AI request${label} to ${aiConfig.endpoint} — model: ${aiConfig.model}, stream: ${payload.stream}, prompt: ${promptChars} chars`);
        console.log(`🤖 AI Web: Prompt${label} (${promptChars} chars):\n${prompt}`);
        const startTime = Date.now();
        try {
            let responseText = null;
            let responseJson = null;
            if (typeof Request !== 'undefined') {
                const request = new Request(aiConfig.endpoint);
                request.method = 'POST';
                request.headers = { 'Content-Type': 'application/json' };
                request.body = JSON.stringify(payload);
                request.timeoutInterval = aiConfig.timeoutSeconds;
                responseText = await request.loadString();
            } else if (typeof fetch === 'function') {
                const response = await fetch(aiConfig.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(aiConfig.timeoutSeconds * 1000)
                });
                if (!response.ok) {
                    console.warn(`🤖 AI Web: AI request${label} returned HTTP ${response.status} after ${Date.now() - startTime}ms`);
                    return null;
                }
                responseText = await response.text();
            } else {
                console.warn(`🤖 AI Web: AI request${label} failed - no HTTP client available (Request/fetch missing)`);
                return null;
            }
            console.log(`🤖 AI Web: Raw AI payload${label} (${responseText ? responseText.length : 0} chars):\n${responseText || ''}`);
            if (responseText) {
                try {
                    responseJson = JSON.parse(responseText);
                } catch (parseError) {
                    console.warn(`🤖 AI Web: AI request${label} returned non-JSON payload (${responseText.length} chars):\n${responseText}`);
                    return null;
                }
            }
            const elapsed = Date.now() - startTime;
            if (responseJson && typeof responseJson.response === 'string' && responseJson.response.length > 0) {
                console.log(`🤖 AI Web: AI request${label} succeeded in ${elapsed}ms — response: ${responseJson.response.length} chars`);
                console.log(`🤖 AI Web: AI response text${label} (${responseJson.response.length} chars):\n${responseJson.response}`);
                return responseJson.response;
            }
            const doneReason = responseJson && typeof responseJson.done_reason === 'string' ? responseJson.done_reason : 'n/a';
            const thinkingChars = responseJson && typeof responseJson.thinking === 'string' ? responseJson.thinking.length : 0;
            console.warn(`🤖 AI Web: AI request${label} completed in ${elapsed}ms with empty response (thinking: ${thinkingChars} chars, done_reason: ${doneReason})`);
            return null;
        } catch (error) {
            const elapsed = Date.now() - startTime;
            const errorType = error && error.name ? error.name : 'Error';
            console.warn(`🤖 AI Web: AI request${label} to ${aiConfig.endpoint} with model ${aiConfig.model} failed after ${elapsed}ms (${errorType}): ${error.message}`);
            return null;
        }
    }

    extractFirstJsonObject(text) {
        if (!text) return null;
        const source = String(text).trim();
        const firstBrace = source.indexOf('{');
        if (firstBrace < 0) return null;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = firstBrace; i < source.length; i++) {
            const ch = source[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }
            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) {
                    return source.slice(firstBrace, i + 1);
                }
            }
        }
        return null;
    }

    parseAiEventResponse(rawText) {
        if (!rawText) return null;
        try {
            const parsed = JSON.parse(rawText);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (parseError) {
            const jsonObject = this.extractFirstJsonObject(rawText);
            if (!jsonObject) return null;
            try {
                const parsed = JSON.parse(jsonObject);
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch (jsonError) {
                return null;
            }
        }
    }

    normalizeAiEvent(aiEvent, parserConfig) {
        const title = this.firstNonEmpty(aiEvent.title, aiEvent.name, aiEvent.summary);
        const description = this.firstNonEmpty(aiEvent.description, aiEvent.desc, '');
        const bar = this.firstNonEmpty(aiEvent.bar, aiEvent.venue, '');
        const address = this.firstNonEmpty(aiEvent.address, aiEvent.addr, '');
        const location = this.firstNonEmpty(aiEvent.location, aiEvent.coords, '');
        const city = this.firstNonEmpty(aiEvent.city, '');
        const url = this.firstNonEmpty(aiEvent.url, aiEvent.web, aiEvent.website, '');
        const ticketUrl = this.firstNonEmpty(aiEvent.ticketUrl, aiEvent.tickets, '');
        const instagram = this.firstNonEmpty(aiEvent.instagram, aiEvent.insta, '');
        const facebook = this.firstNonEmpty(aiEvent.facebook, aiEvent.fb, '');
        const gmaps = this.firstNonEmpty(aiEvent.gmaps, '');
        const image = this.firstNonEmpty(aiEvent.image, aiEvent.img, '');
        const cover = this.firstNonEmpty(aiEvent.cover, '');
        const shortName = this.firstNonEmpty(aiEvent.shortName, aiEvent.short, '');
        const recurrenceRule = this.firstNonEmpty(aiEvent.recurrenceRule, aiEvent.rrule, '');

        const startDate = this.parseDateValue(this.firstNonEmpty(aiEvent.startDate, aiEvent.start, ''));
        const endDate = this.parseDateValue(this.firstNonEmpty(aiEvent.endDate, aiEvent.end, ''));

        if (!title || !startDate) {
            return null;
        }

        const event = {
            title,
            description,
            startDate,
            endDate: endDate || new Date(startDate),
            bar,
            location,
            address,
            city,
            url,
            ticketUrl,
            instagram,
            facebook,
            gmaps,
            image,
            cover,
            shortName,
            recurrenceRule,
            source: this.config.source,
            isBearEvent: false
        };

        if (parserConfig && parserConfig.metadata && typeof parserConfig.metadata === 'object') {
            Object.keys(parserConfig.metadata).forEach(key => {
                const metaValue = parserConfig.metadata[key];
                if (typeof metaValue === 'object' && metaValue !== null && 'value' in metaValue) {
                    event[key] = metaValue.value;
                }
            });
        }

        return event;
    }

    firstNonEmpty(...values) {
        for (const value of values) {
            if (value === null || value === undefined) continue;
            const text = String(value).trim();
            if (text.length > 0) return text;
        }
        return '';
    }

    parseDateValue(value) {
        if (!value) return null;
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
        return null;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AiWebParser };
} else if (typeof window !== 'undefined') {
    window.AiWebParser = AiWebParser;
} else {
    this.AiWebParser = AiWebParser;
}

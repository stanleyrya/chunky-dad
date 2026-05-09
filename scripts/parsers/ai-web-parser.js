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
        this.extractionLimits = {
            yearWindowPastDays: 45,
            yearWindowFutureDays: 210,
            // Small iteration limit for timezone offset convergence around DST boundaries.
            timezoneConvergenceIterations: 4,
            millisPerDay: 24 * 60 * 60 * 1000,
            maxMetaParts: 30,
            maxJsonLdParts: 8,
            maxLinkParts: 40,
            maxBodyParts: 300,
            jsonLdFullnessMinSignals: 4,
            metaFullnessMinSignals: 4,
            noisyLinePrefixes: [
                'share',
                'follow',
                'menu',
                'navigation',
                'recommended',
                'related',
                'you may also like',
                'sign up',
                'subscribe',
                'read more',
                'get tickets',
                'buy tickets'
            ]
        };
        const noisePrefixPattern = this.extractionLimits.noisyLinePrefixes
            .map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
            .join('|');
        this.noiseLineRegex = new RegExp(`^(${noisePrefixPattern})\\b`, 'i');
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

            const event = this.normalizeAiEvent(aiEvent, parserConfig, htmlData, cityConfig);
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

            const rawUrlCandidates = this.extractUrlCandidatesFromRawHtml(html);
            for (const candidate of rawUrlCandidates) {
                const url = this.normalizeUrl(candidate, sourceUrl);
                if (this.isValidEventUrl(url, sourceUrl)) {
                    urls.add(url);
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

        url = this.decodeUrlEscapes(url).replace(/&amp;/g, '&');
        url = url.replace(/[),.;]+$/, '');

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

    decodeUrlEscapes(url) {
        return String(url || '')
            .replace(/\\u002f/gi, '/')
            .replace(/\\u0026/gi, '&')
            .replace(/\\u003a/gi, ':')
            .replace(/\\\//g, '/')
            .replace(/^['"]+|['"]+$/g, '')
            .trim();
    }

    extractUrlCandidatesFromRawHtml(html) {
        if (!html) return [];
        const candidates = new Set();
        const patterns = [
            /https?:\/\/[^\s"'<>\\]+/gi,
            /https?:\\\/\\\/[^\s"'<>]+/gi,
            /\/e\/[a-z0-9-]+-tickets-\d+/gi
        ];

        for (const pattern of patterns) {
            for (const match of html.matchAll(pattern)) {
                if (match[0]) candidates.add(match[0]);
            }
        }

        return Array.from(candidates);
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
        const promptFields = this.getAiPromptFields(parserConfig);
        if (promptFields.length === 0) {
            console.warn('🤖 AI Web: EventSchema.AI_PROMPT_FIELDS unavailable - skipping extraction');
            return null;
        }
        console.log(`🤖 AI Web: Running AI extraction for ${htmlData.url || 'unknown URL'} (${promptFields.length} field${promptFields.length === 1 ? '' : 's'})`);
        const pageSnippet = this.getPageSnippet(htmlData, aiConfig);
        console.log(`🤖 AI Web: Page data sent to AI for ${htmlData.url || 'unknown URL'} (${pageSnippet.length} chars)\n${pageSnippet}`);
        return await this.extractEventWithTwoPassAi(htmlData, aiConfig, cityConfig, parserConfig, promptFields);
    }

    getAiConfig(parserConfig = {}) {
        const aiConfig = parserConfig && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        return {
            enabled: aiConfig.enabled !== false,
            endpoint: String(aiConfig.endpoint || 'http://desktop.taila7523c.ts.net:11434/api/generate'),
            model: String(aiConfig.model || 'qwen3.5:4b'),
            payloadMode: this.normalizePayloadMode(aiConfig.payloadMode),
            maxHtmlChars: Number.isFinite(Number(aiConfig.maxHtmlChars)) ? Number(aiConfig.maxHtmlChars) : 6000,
            numCtx: Number.isFinite(Number(aiConfig.numCtx)) ? Number(aiConfig.numCtx) : 2048,
            numPredict: Number.isFinite(Number(aiConfig.numPredict)) ? Number(aiConfig.numPredict) : 512,
            temperature: Number.isFinite(Number(aiConfig.temperature)) ? Number(aiConfig.temperature) : 0,
            think: Object.prototype.hasOwnProperty.call(aiConfig, 'think') ? Boolean(aiConfig.think) : false,
            timeoutSeconds: Number.isFinite(Number(aiConfig.timeoutSeconds)) ? Number(aiConfig.timeoutSeconds) : 120,
            keepAlive: Object.prototype.hasOwnProperty.call(aiConfig, 'keepAlive') ? String(aiConfig.keepAlive) : '5m'
        };
    }

    normalizePayloadMode(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized === 'exhaustive' || normalized === 'jsonld' || normalized === 'meta') return normalized;
        return 'best';
    }

    cleanHtml(html, aiConfig = {}) {
        if (!html) return '';
        const payloadMode = this.normalizePayloadMode(aiConfig.payloadMode);
        const source = String(html).slice(0, 500000);
        const title = this.extractTitlePart(source);
        const metaParts = this.extractMetaParts(source);
        const jsonLdParts = this.extractJsonLdParts(source);
        const linkParts = this.extractLinkParts(source);
        const bodyParts = this.extractBodyParts(source);
        const sections = [];
        if (title) sections.push(`TITLE\n${title}`);
        if (payloadMode === 'jsonld') {
            if (jsonLdParts.length > 0) {
                sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
            }
        } else if (payloadMode === 'meta') {
            if (metaParts.length > 0) {
                sections.push(`META_PRIMARY\n${metaParts.join('\n')}`);
            }
        } else if (payloadMode === 'best') {
            const jsonLdLooksFull = jsonLdParts.length > 0 && this.isSnippetSourceFull(
                this.scoreJsonLdParts(jsonLdParts),
                this.extractionLimits.jsonLdFullnessMinSignals
            );
            const metaLooksFull = metaParts.length > 0 && this.isSnippetSourceFull(
                this.scoreMetaParts(metaParts),
                this.extractionLimits.metaFullnessMinSignals
            );
            if (jsonLdLooksFull && metaLooksFull) {
                sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
                sections.push(`META_FALLBACK\n${metaParts.join('\n')}`);
            } else {
                if (jsonLdParts.length > 0) sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
                if (metaParts.length > 0) sections.push(`META_FALLBACK\n${metaParts.join('\n')}`);
                if (bodyParts.length > 0) sections.push(`CONTENT\n${bodyParts.join('\n')}`);
                if (linkParts.length > 0) sections.push(`LINKS\n${linkParts.join('\n')}`);
            }
        } else {
            if (jsonLdParts.length > 0) sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
            if (metaParts.length > 0) sections.push(`META_FALLBACK\n${metaParts.join('\n')}`);
            if (bodyParts.length > 0) sections.push(`CONTENT\n${bodyParts.join('\n')}`);
            if (linkParts.length > 0) sections.push(`LINKS\n${linkParts.join('\n')}`);
        }
        return sections.join('\n\n').trim();
    }

    isSnippetSourceFull(score, minSignals) {
        return Number.isFinite(score) && score >= minSignals;
    }

    scoreJsonLdParts(parts) {
        if (!Array.isArray(parts) || parts.length === 0) return 0;
        const keyRegexes = [
            /"name"\s*:/i,
            /"description"\s*:/i,
            /"(startdate|enddate|doorstime|datetime|datepublished)"\s*:/i,
            /"location"\s*:/i,
            /"organizer"\s*:/i,
            /"(url|sameas)"\s*:/i,
            /"(offers|price|pricecurrency|lowprice|highprice)"\s*:/i
        ];
        const joined = parts.join('\n');
        return keyRegexes.reduce((score, regex) => score + (regex.test(joined) ? 1 : 0), 0);
    }

    scoreMetaParts(parts) {
        if (!Array.isArray(parts) || parts.length === 0) return 0;
        const keySet = new Set(parts.map(part => {
            const line = String(part || '').trim().toLowerCase();
            const separatorIndex = line.indexOf(': ');
            return separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : line;
        }).filter(Boolean));
        const hasAny = candidates => candidates.some(candidate => keySet.has(candidate));
        const hasPrefix = prefixes => Array.from(keySet).some(key => prefixes.some(prefix => key.startsWith(prefix)));
        let score = 0;
        if (hasAny(['title', 'description', 'keywords'])) score++;
        if (hasPrefix(['og:'])) score++;
        if (hasPrefix(['twitter:'])) score++;
        if (hasPrefix(['event:'])) score++;
        if (hasAny(['geo.position', 'geo.placename', 'apple-mobile-web-app-title'])) score++;
        if (hasAny(['location', 'venue', 'address'])) score++;
        return score;
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

    getAiPromptFields(parserConfig = {}) {
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
        const aiPromptFields = selected.length > 0 ? selected : this.getDefaultExtractionFields();
        const manuallyScrapedFields = new Set(['instagram', 'facebook', 'gmaps']);
        return aiPromptFields.filter(field => !manuallyScrapedFields.has(this.normalizePromptFieldName(field)));
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

    getPageSnippet(htmlData, aiConfig) {
        const htmlCharLimit = Math.max(500, Number(aiConfig.maxHtmlChars));
        const html = htmlData && typeof htmlData.html === 'string' ? htmlData.html : '';
        return this.cleanHtml(html, aiConfig).slice(0, htmlCharLimit);
    }

    buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields) {
        const snippet = this.getPageSnippet(htmlData, aiConfig);
        const promptFields = Array.isArray(fields) && fields.length > 0
            ? fields
            : this.getAiPromptFields(parserConfig);
        const fieldContext = this.buildFieldContextText(promptFields, cityConfig);
        return `Extract exactly one event from this page and return ONLY valid JSON.
Preferred keys:
${fieldContext}
Rules:
- Return a single JSON object only
- Return only keys from the Preferred keys list
- Omit unknown fields
- Treat JSON_LD_PRIMARY as the authoritative source when present
- Use META_FALLBACK only to fill missing fields or confirm JSON_LD_PRIMARY
- For cover, prefer explicit price/admission text and return concise plain text (e.g. "$20", "$20-$30.65", "Free")

URL: ${htmlData.url || ''}
HTML:
${snippet}`;
    }

    buildJsonRepairPrompt(rawResponse, aiConfig, cityConfig, parserConfig, fields) {
        const promptFields = Array.isArray(fields) && fields.length > 0
            ? fields
            : this.getAiPromptFields(parserConfig);
        const fieldContext = this.buildFieldContextText(promptFields, cityConfig);
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

    async callAiGenerate(aiConfig, prompt, passLabel) {
        if (!prompt) return null;
        const label = passLabel ? ` (${passLabel} pass)` : '';
        const promptChars = prompt.length;
        const payload = {
            model: aiConfig.model,
            prompt,
            format: 'json',
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
            if (responseText) {
                try {
                    responseJson = JSON.parse(responseText);
                } catch (parseError) {
                    console.warn(`🤖 AI Web: AI request${label} returned non-JSON payload (${responseText.length} chars)`);
                    return null;
                }
            }
            const elapsed = Date.now() - startTime;
            if (responseJson && typeof responseJson.response === 'string' && responseJson.response.length > 0) {
                console.log(`🤖 AI Web: AI request${label} succeeded in ${elapsed}ms — response: ${responseJson.response.length} chars`);
                return responseJson.response;
            }
            const doneReason = responseJson && typeof responseJson.done_reason === 'string' ? responseJson.done_reason : 'n/a';
            console.warn(`🤖 AI Web: AI request${label} completed in ${elapsed}ms with empty response (done_reason: ${doneReason})`);
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

    normalizeAiEvent(aiEvent, parserConfig, htmlData = null, cityConfig = null) {
        const scrapedLinks = this.extractLinksFromPage(
            htmlData && typeof htmlData.html === 'string' ? htmlData.html : '',
            htmlData && typeof htmlData.url === 'string' ? htmlData.url : ''
        );
        const title = this.firstNonEmpty(aiEvent.title, aiEvent.name, aiEvent.summary);
        const description = this.firstNonEmpty(aiEvent.description, aiEvent.desc, '');
        const bar = this.firstNonEmpty(aiEvent.bar, aiEvent.venue, '');
        const address = this.firstNonEmpty(aiEvent.address, aiEvent.addr, '');
        const location = this.firstNonEmpty(aiEvent.location, aiEvent.coords, '');
        const city = this.firstNonEmpty(aiEvent.city, parserConfig && parserConfig.city, '');
        const timezone = this.firstNonEmpty(
            aiEvent.timezone,
            this.getTimezoneForCity(city, cityConfig),
            this.getTimezoneForCity(parserConfig && parserConfig.city, cityConfig),
            ''
        );
        const url = this.firstNonEmpty(aiEvent.url, aiEvent.web, aiEvent.website, '');
        const ticketUrl = this.firstNonEmpty(aiEvent.ticketUrl, aiEvent.tickets, '');
        const instagram = this.firstNonEmpty(scrapedLinks.instagram, aiEvent.instagram, aiEvent.insta, '');
        const facebook = this.firstNonEmpty(scrapedLinks.facebook, aiEvent.facebook, aiEvent.fb, '');
        const gmaps = this.firstNonEmpty(scrapedLinks.gmaps, aiEvent.gmaps, '');
        const image = this.firstNonEmpty(aiEvent.image, aiEvent.img, '');
        const cover = this.firstNonEmpty(aiEvent.cover, '');
        const shortName = this.firstNonEmpty(aiEvent.shortName, aiEvent.short, '');
        const recurrenceRule = this.firstNonEmpty(aiEvent.recurrenceRule, aiEvent.rrule, '');

        const startDateRaw = this.parseDateValue(this.firstNonEmpty(aiEvent.startDate, aiEvent.start, ''), timezone);
        const endDateRaw = this.parseDateValue(this.firstNonEmpty(aiEvent.endDate, aiEvent.end, ''), timezone);
        const { startDate, endDate } = this.normalizeEventDates(startDateRaw, endDateRaw);

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
            timezone,
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

    getCityConfigMap(cityConfig) {
        if (!cityConfig || typeof cityConfig !== 'object') return null;
        if (cityConfig.cities && typeof cityConfig.cities === 'object') {
            return cityConfig.cities;
        }
        return cityConfig;
    }

    getTimezoneForCity(city, cityConfig) {
        const map = this.getCityConfigMap(cityConfig);
        if (!map || typeof map !== 'object') return '';
        const cityText = String(city || '').trim();
        if (!cityText) return '';

        const direct = map[cityText];
        if (direct && typeof direct === 'object' && typeof direct.timezone === 'string' && direct.timezone.trim()) {
            return direct.timezone.trim();
        }

        const normalizedCity = cityText.toLowerCase();
        const matchedKey = Object.keys(map).find(key => String(key).toLowerCase() === normalizedCity);
        if (!matchedKey) return '';
        const matched = map[matchedKey];
        if (!matched || typeof matched !== 'object' || typeof matched.timezone !== 'string') return '';
        return matched.timezone.trim();
    }

    hasExplicitTimezoneInfo(dateValue) {
        const valueText = String(dateValue || '').trim();
        if (!valueText) return false;
        return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(valueText) || /\b(?:UTC|GMT)\b/i.test(valueText);
    }

    getTimezoneOffsetMinutes(date, timezone) {
        if (!date || !timezone) return null;
        try {
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: timezone,
                timeZoneName: 'longOffset'
            });
            const parts = formatter.formatToParts(date);
            const offsetPart = parts.find(part => part.type === 'timeZoneName');
            const offsetText = offsetPart && typeof offsetPart.value === 'string' ? offsetPart.value : '';
            const offsetMatch = offsetText.match(/GMT([+-])(\d{2}):(\d{2})/);
            if (!offsetMatch) return null;
            const sign = offsetMatch[1] === '+' ? 1 : -1;
            const hours = parseInt(offsetMatch[2], 10);
            const minutes = parseInt(offsetMatch[3], 10);
            return sign * ((hours * 60) + minutes);
        } catch (_) {
            return null;
        }
    }

    convertLocalDateTimeToUtc(localDateTimeValue, timezone) {
        if (!localDateTimeValue || !timezone || typeof localDateTimeValue !== 'string') {
            return null;
        }

        const valueText = localDateTimeValue.trim();
        // Supports "YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm:ss".
        const match = valueText.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)?$/);
        if (!match) {
            return null;
        }

        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);
        const hour = parseInt(match[4] || '0', 10);
        const minute = parseInt(match[5] || '0', 10);
        const second = parseInt(match[6] || '0', 10);

        // Build an initial UTC guess from local components, then iteratively converge
        // to the UTC instant whose timezone offset maps back to the requested local time.
        // Iteration is needed near DST transitions where the first offset guess can be wrong.
        const baseUtcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
        let utcMillis = baseUtcMillis;
        for (let i = 0; i < this.extractionLimits.timezoneConvergenceIterations; i++) {
            const offsetMinutes = this.getTimezoneOffsetMinutes(new Date(utcMillis), timezone);
            if (!Number.isFinite(offsetMinutes)) {
                return null;
            }
            const nextUtcMillis = baseUtcMillis - (offsetMinutes * 60 * 1000);
            if (nextUtcMillis === utcMillis) {
                break;
            }
            utcMillis = nextUtcMillis;
        }

        return new Date(utcMillis);
    }

    parseDateValue(value, timezoneHint = null) {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }
        if (typeof value === 'number') {
            const numericDate = new Date(value);
            return Number.isNaN(numericDate.getTime()) ? null : numericDate;
        }

        const valueText = String(value).trim();
        if (!valueText) return null;

        if (timezoneHint && !this.hasExplicitTimezoneInfo(valueText) && /\d{1,2}:\d{2}/.test(valueText)) {
            const converted = this.convertLocalDateTimeToUtc(valueText, timezoneHint);
            if (converted && !Number.isNaN(converted.getTime())) {
                return converted;
            }
        }

        const parsed = new Date(valueText);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
        return null;
    }

    normalizeEventDates(startDate, endDate) {
        const adjustedStart = this.adjustLikelyEventYear(startDate);
        const adjustedEnd = this.adjustLikelyEventYear(endDate);
        if (!adjustedStart) {
            return { startDate: null, endDate: null };
        }
        let normalizedEnd = adjustedEnd || new Date(adjustedStart);
        if (normalizedEnd < adjustedStart) {
            normalizedEnd = new Date(adjustedStart);
        }
        return { startDate: adjustedStart, endDate: normalizedEnd };
    }

    adjustLikelyEventYear(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        const now = new Date();
        const dayMs = this.extractionLimits.millisPerDay;
        const windowStart = new Date(now.getTime() - (this.extractionLimits.yearWindowPastDays * dayMs));
        const windowEnd = new Date(now.getTime() + (this.extractionLimits.yearWindowFutureDays * dayMs));
        if (date >= windowStart && date <= windowEnd) {
            return new Date(date);
        }

        const year = date.getFullYear();
        const candidates = [year - 1, year, year + 1].map(candidateYear => {
            const candidate = new Date(date);
            candidate.setFullYear(candidateYear);
            return candidate;
        });
        const inWindow = candidates.filter(candidate => candidate >= windowStart && candidate <= windowEnd);
        const candidateSet = inWindow.length > 0 ? inWindow : candidates;
        return candidateSet.reduce((best, candidate) => {
            if (!best) return candidate;
            return Math.abs(candidate.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())
                ? candidate
                : best;
        }, null);
    }

    extractTitlePart(html) {
        const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        if (!match) return '';
        return this.normalizeWhitespace(this.stripTags(match[1]));
    }

    extractMetaParts(html) {
        const results = [];
        const seen = new Set();
        const regex = /<meta\b[^>]*>/gi;
        const excludedMetaKeyRegexes = [
            /^apple-mobile-web-app-title$/i,
            /^keywords$/i,
            /^og:(site_name|locale|determiner)$/i,
            /^twitter:site$/i,
            /^twitter:app:/i,
            /^twitter:(label\d+|data\d+)$/i
        ];
        let match;
        while ((match = regex.exec(html)) !== null) {
            const tag = match[0];
            const nameMatch = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i);
            const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
            if (!nameMatch || !contentMatch) continue;
            const key = this.normalizeWhitespace(nameMatch[1]).toLowerCase();
            if (excludedMetaKeyRegexes.some(regexPattern => regexPattern.test(key))) continue;
            const allowedMetaKeys = new Set([
                'description',
                'title',
                'location',
                'venue',
                'address',
                'geo.position',
                'geo.placename'
            ]);
            const hasAllowedPrefix = key.startsWith('og:') || key.startsWith('twitter:') || key.startsWith('event:');
            if (!hasAllowedPrefix && !allowedMetaKeys.has(key)) continue;
            const value = this.sanitizeMetaContent(key, contentMatch[1]);
            if (!value) continue;
            const line = `${key}: ${value}`;
            const dedupeKey = line.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            results.push(line);
            if (results.length >= this.extractionLimits.maxMetaParts) break;
        }
        return results;
    }

    extractJsonLdParts(html) {
        const results = [];
        const eventResults = [];
        const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const text = this.normalizeJsonLdPayload(match[1] || '');
            if (!text) continue;
            results.push(text);
            if (this.containsEventType(text)) {
                eventResults.push(text);
            }
            if (results.length >= this.extractionLimits.maxJsonLdParts * 2) break;
        }
        const selected = eventResults.length > 0 ? eventResults : results;
        return selected.slice(0, this.extractionLimits.maxJsonLdParts);
    }

    extractLinkParts(html) {
        const results = [];
        const seen = new Set();
        const regex = /href=["']([^"']+)["']/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const rawUrl = match[1];
            if (!rawUrl || rawUrl.startsWith('#')) continue;
            const normalized = this.normalizeWhitespace(rawUrl);
            if (!/^https?:\/\//i.test(normalized)) continue;
            const dedupeKey = normalized.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            results.push(normalized);
            if (results.length >= this.extractionLimits.maxLinkParts) break;
        }
        return results;
    }

    extractBodyParts(html) {
        let text = String(html);
        text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ');
        text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ');
        text = text.replace(/<!--[\s\S]*?-->/g, ' ');
        text = text.replace(/<(nav|header|footer|aside|noscript|form|button)\b[^>]*>[\s\S]*?<\/\1[^>]*>/gi, ' ');
        text = text.replace(/<[a-z0-9]+\b[^>]*(?:class|id)=["'][^"']*(nav|menu|footer|header|share|social|recommend|carousel|cta|newsletter|breadcrumb)[^"']*["'][^>]*>[\s\S]{0,12000}?<\/[a-z0-9]+>/gi, ' ');
        text = text.replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|\/tr|\/td)\b[^>]*>/gi, '\n');
        text = text.replace(/<[^>]+>/g, ' ');

        const lines = text
            .split('\n')
            .map(line => this.normalizeWhitespace(this.decodeBasicEntities(line)))
            .filter(Boolean);

        const seen = new Set();
        const results = [];
        for (const line of lines) {
            const lower = line.toLowerCase();
            if (line.length < 3) continue;
            if (this.noiseLineRegex.test(line)) continue;
            if (seen.has(lower)) continue;
            seen.add(lower);
            results.push(line);
            if (results.length >= this.extractionLimits.maxBodyParts) break;
        }
        return results;
    }

    decodeBasicEntities(text) {
        return String(text || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>');
    }

    stripTags(text) {
        return String(text || '').replace(/<[^>]+>/g, ' ');
    }

    normalizeWhitespace(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    sanitizeMetaContent(key, value) {
        const normalizedKey = String(key || '').toLowerCase();
        const normalizedValue = this.normalizeWhitespace(this.decodeBasicEntities(value || ''));
        if (!normalizedValue) return '';
        const likelyUrlKey = /(?:^|:)(?:url|image|video|audio)$/.test(normalizedKey) || /(url|image)/.test(normalizedKey);
        if (likelyUrlKey || this.isLikelyUrlValue(normalizedValue)) {
            return this.simplifyUrlValue(normalizedValue, { stripQuery: true });
        }
        return this.trimToMaxLength(normalizedValue, 320);
    }

    normalizeJsonLdPayload(rawText) {
        const normalized = this.normalizeWhitespace(this.decodeBasicEntities(rawText || ''));
        if (!normalized) return '';
        let parsed = null;
        try {
            parsed = JSON.parse(normalized);
        } catch (_) {
            return this.trimToMaxLength(normalized, 2000);
        }
        const compact = this.compactJsonLdValue(parsed);
        if (compact === null || compact === undefined || compact === '') return '';
        try {
            return JSON.stringify(compact);
        } catch (_) {
            return this.trimToMaxLength(normalized, 2000);
        }
    }

    compactJsonLdValue(value, keyName = '') {
        if (value === null || value === undefined) return null;
        if (Array.isArray(value)) {
            const compacted = value
                .map(item => this.compactJsonLdValue(item, keyName))
                .filter(item => item !== null && item !== undefined && item !== '');
            return compacted.length > 0 ? compacted : null;
        }
        if (typeof value === 'object') {
            const dropKeyPattern = /^(speakable|breadcrumb|itemListElement|potentialAction)$/i;
            const result = {};
            Object.keys(value).forEach(key => {
                if (dropKeyPattern.test(key)) return;
                const compacted = this.compactJsonLdValue(value[key], key);
                if (compacted === null || compacted === undefined || compacted === '') return;
                result[key] = compacted;
            });
            return Object.keys(result).length > 0 ? result : null;
        }
        if (typeof value === 'string') {
            const normalized = this.normalizeWhitespace(this.decodeBasicEntities(value));
            if (!normalized) return '';
            const lowerKey = String(keyName || '').toLowerCase();
            if (this.isLikelyUrlValue(normalized) || /(url|image|logo|sameas|@id)/.test(lowerKey)) {
                return this.simplifyUrlValue(normalized, { stripQuery: true });
            }
            const maxLength = /(description)/.test(lowerKey) ? 500 : 240;
            return this.trimToMaxLength(normalized, maxLength);
        }
        return value;
    }

    containsEventType(jsonText) {
        try {
            const parsed = JSON.parse(jsonText);
            return this.hasEventTypeValue(parsed);
        } catch (_) {
            return /"@type"\s*:\s*(?:"[^"]*event[^"]*"|\[[^\]]*event[^\]]*\])/i.test(String(jsonText || ''));
        }
    }

    hasEventTypeValue(node) {
        if (!node) return false;
        if (Array.isArray(node)) return node.some(item => this.hasEventTypeValue(item));
        if (typeof node !== 'object') return false;
        const typeValue = node['@type'];
        if (typeof typeValue === 'string' && /event/i.test(typeValue)) return true;
        if (Array.isArray(typeValue) && typeValue.some(type => typeof type === 'string' && /event/i.test(type))) {
            return true;
        }
        return Object.keys(node).some(key => this.hasEventTypeValue(node[key]));
    }

    isLikelyUrlValue(value) {
        const text = String(value || '').trim();
        return /^https?:\/\//i.test(text) || /^\/[^\s]/.test(text);
    }

    simplifyUrlValue(value, options = {}) {
        const stripQuery = options && Object.prototype.hasOwnProperty.call(options, 'stripQuery')
            ? Boolean(options.stripQuery)
            : true;
        let text = this.decodeUrlEscapes(this.decodeBasicEntities(value || ''));
        text = this.normalizeWhitespace(text);
        if (!text) return '';

        if (text.startsWith('/e/_next/image?')) {
            try {
                const proxyUrl = new URL(`https://placeholder.local${text}`);
                const wrapped = proxyUrl.searchParams.get('url');
                if (wrapped) {
                    const decodedWrapped = this.decodeUrlEscapes(this.decodeBasicEntities(wrapped));
                    return this.simplifyUrlValue(decodedWrapped, options);
                }
            } catch (_) {}
        }

        if (!/^https?:\/\//i.test(text) && !/^\/[^\s]/.test(text)) {
            return this.trimToMaxLength(text, 320);
        }

        try {
            const baseUrl = text.startsWith('/') ? 'https://placeholder.local' : undefined;
            const parsed = new URL(text, baseUrl);
            if (stripQuery) {
                parsed.search = '';
                parsed.hash = '';
            }
            const normalized = parsed.toString();
            if (text.startsWith('/')) {
                return normalized.replace(/^https:\/\/placeholder\.local/i, '');
            }
            return normalized;
        } catch (_) {
            return this.trimToMaxLength(text, 320);
        }
    }

    trimToMaxLength(text, maxLength) {
        const normalized = this.normalizeWhitespace(text || '');
        if (!Number.isFinite(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
            return normalized;
        }
        return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
    }

    extractLinksFromPage(html, sourceUrl) {
        if (!html) return { instagram: '', facebook: '', gmaps: '' };
        const links = [];
        const hrefRegex = /href=["']([^"']+)["']/gi;
        const contentUrlRegex = /<meta\b[^>]*content=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = hrefRegex.exec(html)) !== null) {
            links.push(match[1]);
        }
        while ((match = contentUrlRegex.exec(html)) !== null) {
            links.push(match[1]);
        }
        let instagram = '';
        let facebook = '';
        let gmaps = '';

        for (const link of links) {
            const normalized = this.normalizeUrl(link, sourceUrl);
            if (!normalized || !/^https?:\/\//i.test(normalized)) continue;
            let parsedUrl = null;
            try {
                parsedUrl = new URL(normalized);
            } catch (_) {
                continue;
            }
            const host = String(parsedUrl.hostname || '').toLowerCase();
            const path = String(parsedUrl.pathname || '').toLowerCase();
            const isInstagram = host === 'instagram.com' || host.endsWith('.instagram.com');
            const isFacebook = host === 'facebook.com' || host.endsWith('.facebook.com');
            const isGoogleMaps = host === 'maps.app.goo.gl' || host.endsWith('.maps.app.goo.gl') || (
                (host === 'google.com' || host.endsWith('.google.com')) &&
                path.startsWith('/maps')
            );
            if (!instagram && isInstagram) instagram = normalized;
            if (!facebook && isFacebook) facebook = normalized;
            if (!gmaps && isGoogleMaps) gmaps = normalized;
            if (instagram && facebook && gmaps) break;
        }

        return { instagram, facebook, gmaps };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AiWebParser };
} else if (typeof window !== 'undefined') {
    window.AiWebParser = AiWebParser;
} else {
    this.AiWebParser = AiWebParser;
}

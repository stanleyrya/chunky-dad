// ============================================================================
// AI WEB PARSER
// ============================================================================
// Handles AI extraction + event normalization for pages that don't parse well
// with deterministic selectors.
// ============================================================================

class AiWebParser {
    static DEFAULT_EXTRACTION_FIELDS = [
        'title', 'shortName', 'description', 'city', 'bar', 'address', 'location',
        'startDate', 'endDate', 'recurrenceRule', 'url', 'ticketUrl',
        'instagram', 'facebook', 'gmaps', 'image', 'cover'
    ];

    constructor(config = {}) {
        this.config = {
            source: 'ai-web',
            ...config
        };
    }

    async parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const aiEvent = await this.getAiEvent(htmlData, parserConfig);
            if (!aiEvent) {
                return this.buildEmptyResult(htmlData);
            }

            const event = this.normalizeAiEvent(aiEvent, parserConfig);
            if (!event || !event.title || !event.startDate) {
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

    buildEmptyResult(htmlData) {
        return {
            events: [],
            additionalLinks: [],
            source: this.config.source,
            url: htmlData && htmlData.url ? htmlData.url : ''
        };
    }

    async getAiEvent(htmlData, parserConfig) {
        if (!htmlData || typeof htmlData !== 'object') return null;
        if (htmlData.aiEvent && typeof htmlData.aiEvent === 'object') return htmlData.aiEvent;
        if (htmlData.aiExtraction && typeof htmlData.aiExtraction.event === 'object') {
            return htmlData.aiExtraction.event;
        }
        const aiConfig = this.getAiConfig(parserConfig);
        if (!aiConfig.enabled || !htmlData.html) {
            return null;
        }
        return await this.extractEventWithTwoPassAi(htmlData, aiConfig);
    }

    getAiConfig(parserConfig = {}) {
        const aiConfig = parserConfig && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        const configuredFields = Array.isArray(aiConfig.fields)
            ? aiConfig.fields.map(field => String(field || '').trim()).filter(Boolean)
            : [];
        return {
            enabled: aiConfig.enabled !== false,
            endpoint: String(aiConfig.endpoint || 'http://127.0.0.1:11434/api/generate'),
            model: String(aiConfig.model || 'llama3'),
            maxHtmlChars: Number.isFinite(Number(aiConfig.maxHtmlChars)) ? Number(aiConfig.maxHtmlChars) : 12000,
            fields: configuredFields
        };
    }

    getAiPromptFields(aiConfig) {
        if (aiConfig && Array.isArray(aiConfig.fields) && aiConfig.fields.length > 0) {
            return aiConfig.fields;
        }
        return AiWebParser.DEFAULT_EXTRACTION_FIELDS;
    }

    buildExtractionPrompt(htmlData, aiConfig) {
        const htmlCharLimit = Math.max(500, Number(aiConfig.maxHtmlChars));
        const snippet = String(htmlData.html || '').slice(0, htmlCharLimit);
        const fields = this.getAiPromptFields(aiConfig);
        return `Extract exactly one event from this page and return JSON only.
Preferred keys: ${fields.join(', ')}.
Rules:
- Return a single JSON object only
- Use ISO datetime for startDate/endDate when possible
- Omit unknown fields

URL: ${htmlData.url || ''}
HTML:
${snippet}`;
    }

    buildJsonRepairPrompt(rawResponse, aiConfig) {
        const fields = this.getAiPromptFields(aiConfig);
        return `Convert this text into one strict JSON object for an event.
Preferred keys: ${fields.join(', ')}.
Rules:
- JSON object only
- No markdown
- No commentary
- Omit unknown fields

TEXT:
${String(rawResponse || '')}`;
    }

    async extractEventWithTwoPassAi(htmlData, aiConfig) {
        const extractPrompt = this.buildExtractionPrompt(htmlData, aiConfig);
        const firstPass = await this.callAiGenerate(aiConfig, extractPrompt);
        if (!firstPass) return null;
        const parsedFirstPass = this.parseAiEventResponse(firstPass);
        if (parsedFirstPass) return parsedFirstPass;
        const repairPrompt = this.buildJsonRepairPrompt(firstPass, aiConfig);
        const secondPass = await this.callAiGenerate(aiConfig, repairPrompt);
        if (!secondPass) return null;
        return this.parseAiEventResponse(secondPass);
    }

    async callAiGenerate(aiConfig, prompt) {
        if (!prompt) return null;
        const payload = {
            model: aiConfig.model,
            prompt,
            stream: false
        };
        try {
            if (typeof Request !== 'undefined') {
                const request = new Request(aiConfig.endpoint);
                request.method = 'POST';
                request.headers = { 'Content-Type': 'application/json' };
                request.body = JSON.stringify(payload);
                const responseJson = await request.loadJSON();
                return responseJson && typeof responseJson.response === 'string'
                    ? responseJson.response
                    : null;
            }
            if (typeof fetch === 'function') {
                const response = await fetch(aiConfig.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) return null;
                const responseJson = await response.json();
                return responseJson && typeof responseJson.response === 'string'
                    ? responseJson.response
                    : null;
            }
        } catch (error) {
            const errorType = error && error.name ? error.name : 'Error';
            console.warn(`🤖 AI Web: AI request to ${aiConfig.endpoint} with model ${aiConfig.model} failed (${errorType}): ${error.message}`);
            return null;
        }
        return null;
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

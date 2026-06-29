import sys
with open('scripts/parsers/ai-web-parser.js', 'r') as f:
    content = f.read()

func_old = """    async extractEventWithTwoPassAi(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet, passLabel = '', options = {}, httpAdapter = null) {
        // Setup
        const passSuffix = passLabel ? ` ${passLabel}` : '';
        const dataFlags = options && options.dataFlags && typeof options.dataFlags === 'object' ? options.dataFlags : {};
        const useAlternate = options && options.promptVariant === 'alternate';

        let processedSnippet = snippet;"""

func_new = """    async extractEventWithTwoPassAi(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet, passLabel = '', options = {}, httpAdapter = null) {
        // Setup
        const passSuffix = passLabel ? ` ${passLabel}` : '';
        const dataFlags = options && options.dataFlags && typeof options.dataFlags === 'object' ? options.dataFlags : {};
        const useAlternate = options && options.promptVariant === 'alternate';

        const parseAndFilterConfidence = (rawResponse) => {
            if (!rawResponse) return null;
            let event = this.core.parseAiEventResponse(rawResponse);
            if (!event) return null;

            const filteredEvent = {};
            for (const key in event) {
                if (!Object.prototype.hasOwnProperty.call(event, key)) continue;
                if (this.isInternalAiFieldKey(key)) {
                    filteredEvent[key] = event[key];
                    continue;
                }

                const fieldData = event[key];
                if (fieldData && typeof fieldData === 'object' && 'value' in fieldData) {
                    const confidence = fieldData.confidence;
                    if (typeof confidence === 'number' && confidence < 50) {
                        console.log(`🤖 AI Web: Dropping field ${key} due to low confidence (${confidence})`);
                        continue; // Drop it
                    }
                    filteredEvent[key] = fieldData.value;
                } else {
                    // Fallback in case AI doesn't follow the format perfectly
                    filteredEvent[key] = fieldData;
                }
            }
            return filteredEvent;
        };

        let processedSnippet = snippet;"""

content = content.replace(func_old, func_new)

content = content.replace(
    "let event = this.core.parseAiEventResponse(rawResponse);",
    "let event = parseAndFilterConfidence(rawResponse);",
    1
)

content = content.replace(
    "event = this.core.parseAiEventResponse(rawResponse);",
    "event = parseAndFilterConfidence(rawResponse);",
    1
)

content = content.replace(
    "event = this.core.parseAiEventResponse(repairResponse);",
    "event = parseAndFilterConfidence(repairResponse);",
    1
)

with open('scripts/parsers/ai-web-parser.js', 'w') as f:
    f.write(content)

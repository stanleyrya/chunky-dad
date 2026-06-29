import sys
with open('scripts/parsers/ai-web-parser.js', 'r') as f:
    content = f.read()

# I also need to replace the alternate parsing call which I missed.
content = content.replace(
    "event = this.core.parseAiEventResponse(rawResponse);",
    "event = parseAndFilterConfidence(rawResponse);"
)

with open('scripts/parsers/ai-web-parser.js', 'w') as f:
    f.write(content)

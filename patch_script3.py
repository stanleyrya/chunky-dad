import sys
with open('scripts/parsers/ai-web-parser.js', 'r') as f:
    content = f.read()

bad = "let event = parseAndFilterConfidence(rawResponse);"
good = "let event = this.core.parseAiEventResponse(rawResponse);"

content = content.replace(bad, good, 1)

with open('scripts/parsers/ai-web-parser.js', 'w') as f:
    f.write(content)

import sys
with open('scripts/parsers/ai-web-parser.js', 'r') as f:
    content = f.read()

default_old = """            default: `You are a data scraper. You are being provided part of a website that includes information about an event. You must check if any of the requested keys are within the provided scraped data and return it as ONLY valid JSON. If a requested key is not explicitly in the source text, skip and omit it.
${dataProvided}${sourceData}${additionalContext}Preferred keys:
${fieldContext}
Rules:
- Return a single JSON object only
- Return only keys from the Preferred keys list
- Omit unknown fields; do not invent details and do not estimate. ONLY use data from the source material.

`,"""

default_new = """            default: `You are a data scraper. You are being provided part of a website that includes information about an event. You must check if any of the requested keys are within the provided scraped data and return it as ONLY valid JSON. If a requested key is not explicitly in the source text, skip and omit it.

Format each extracted field as a JSON object containing "value", "evidence", and "confidence".
Example:
{
  "title": {
    "value": "Annual Bear Party",
    "evidence": "Join us for the Annual Bear Party!",
    "confidence": 95
  }
}

${dataProvided}${sourceData}${additionalContext}Preferred keys:
${fieldContext}
Rules:
- Return a single JSON object only
- Return only keys from the Preferred keys list, formatted as objects with value, evidence, and confidence (0-100)
- Omit unknown fields; do not invent details and do not estimate. ONLY use data from the source material.

`,"""

alt_old = """            alternate: `You are extracting specific event fields from web page source data. Carefully search the entire provided text for the listed fields — they may appear in metadata, structured data, or body text. Return only what you find as a single valid JSON object.
${dataProvided}${sourceData}${additionalContext}Fields to find:
${fieldContext}
Rules:
- Return a single JSON object only
- Include only fields whose values are found verbatim in the text below
- Do not guess, invent, or infer missing values
- Omit any field not explicitly present in the source

`,"""

alt_new = """            alternate: `You are extracting specific event fields from web page source data. Carefully search the entire provided text for the listed fields — they may appear in metadata, structured data, or body text. Return only what you find as a single valid JSON object.

Format each extracted field as a JSON object containing "value", "evidence", and "confidence".
Example:
{
  "title": {
    "value": "Annual Bear Party",
    "evidence": "Join us for the Annual Bear Party!",
    "confidence": 95
  }
}

${dataProvided}${sourceData}${additionalContext}Fields to find:
${fieldContext}
Rules:
- Return a single JSON object only
- Include only fields whose values are found verbatim in the text below, formatted as objects with value, evidence, and confidence (0-100)
- Do not guess, invent, or infer missing values
- Omit any field not explicitly present in the source

`,"""

repair_old = """            repair: `Convert this text into one strict JSON object for an event.
${additionalContext}Preferred keys:
${fieldContext}
Rules:
- JSON object only
- Use only the preferred keys
- No markdown
- No commentary
- Omit unknown fields
- Do not infer missing facts; keep only details explicitly supported by source text

TEXT:
`"""

repair_new = """            repair: `Convert this text into one strict JSON object for an event.

Format each extracted field as a JSON object containing "value", "evidence", and "confidence".
Example:
{
  "title": {
    "value": "Annual Bear Party",
    "evidence": "Join us for the Annual Bear Party!",
    "confidence": 95
  }
}

${additionalContext}Preferred keys:
${fieldContext}
Rules:
- JSON object only
- Use only the preferred keys, formatted as objects with value, evidence, and confidence (0-100)
- No markdown
- No commentary
- Omit unknown fields
- Do not infer missing facts; keep only details explicitly supported by source text

TEXT:
`"""

content = content.replace(default_old, default_new)
content = content.replace(alt_old, alt_new)
content = content.replace(repair_old, repair_new)

with open('scripts/parsers/ai-web-parser.js', 'w') as f:
    f.write(content)

const fs = require('fs');
const content = fs.readFileSync('scripts/parsers/ai-web-parser.js', 'utf8');
const match = content.match(/buildExtractionPrompt\([\s\S]*?return `\$\{templates\[variant\]\}\$\{String\(snippet \|\| ''\)\}`;/);
if (match) console.log(match[0]);

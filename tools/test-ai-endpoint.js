#!/usr/bin/env node
// ============================================================================
// AI ENDPOINT TEST SCRIPT
// ============================================================================
// Quick smoke-test for the Ollama AI endpoint used by the ai-web parser.
// Run with: node tools/test-ai-endpoint.js [endpoint] [model]
//
// Examples:
//   node tools/test-ai-endpoint.js
//   node tools/test-ai-endpoint.js http://desktop.taila7523c.ts.net:11434/api/generate qwen3.5:4b
// ============================================================================

// Default matches the ai-web-parser.js default endpoint; override via command-line arg.
const endpoint = process.argv[2] || 'http://desktop.taila7523c.ts.net:11434/api/generate';
const model = process.argv[3] || 'qwen3.5:4b';
const prompt = 'Reply with only valid JSON: {"answer": "ok"}';

console.log('AI Endpoint Test');
console.log('=================');
console.log(`Endpoint : ${endpoint}`);
console.log(`Model    : ${model}`);
console.log(`Prompt   : ${prompt}`);
console.log('');

const payload = JSON.stringify({ model, prompt, stream: false });

const url = new URL(endpoint);
const isHttps = url.protocol === 'https:';
const http = isHttps ? require('https') : require('http');

const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + (url.search || ''),
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 120000
};

const startTime = Date.now();
console.log(`Sending request at ${new Date().toISOString()} ...`);

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
        const elapsed = Date.now() - startTime;
        console.log(`Response received after ${elapsed}ms`);
        console.log(`HTTP status: ${res.statusCode}`);
        if (res.statusCode !== 200) {
            console.error(`ERROR: Non-200 status. Body: ${body.slice(0, 500)}`);
            process.exit(1);
        }
        try {
            const json = JSON.parse(body);
            if (json.response) {
                console.log(`\nAI response (${json.response.length} chars):\n${json.response}`);
                if (json.eval_duration) {
                    console.log(`\nOllama eval_duration: ${(json.eval_duration / 1e9).toFixed(2)}s`);
                }
                console.log('\n✅ SUCCESS — AI endpoint is reachable and responding.');
            } else {
                console.warn('\n⚠️  Request succeeded but response field is missing or empty.');
                console.log('Full body:', JSON.stringify(json, null, 2));
            }
        } catch (e) {
            console.error(`ERROR: Could not parse response JSON. Body: ${body.slice(0, 500)}`);
            process.exit(1);
        }
    });
});

req.on('timeout', () => {
    const elapsed = Date.now() - startTime;
    console.error(`\n❌ TIMEOUT after ${elapsed}ms — the request timed out before the server responded.`);
    console.error('This matches the error seen in the scraper. Possible causes:');
    console.error('  1. The model is too slow for the hardware (try a smaller model)');
    console.error('  2. The Tailscale connection is too slow for large payloads');
    console.error('  3. Ollama is busy or unresponsive');
    req.destroy();
    process.exit(1);
});

req.on('error', (err) => {
    const elapsed = Date.now() - startTime;
    console.error(`\n❌ ERROR after ${elapsed}ms: ${err.message}`);
    if (err.code === 'ECONNREFUSED') {
        console.error('  → Ollama is not running or the endpoint is wrong.');
    } else if (err.code === 'ENOTFOUND') {
        console.error('  → Hostname not found — check Tailscale connection.');
    }
    process.exit(1);
});

req.write(payload);
req.end();

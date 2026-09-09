#!/usr/bin/env node
// ============================================================================
// ai-eval — replay real scraper prompts against a local model and score them
// ============================================================================
// Commands
//   harvest   build test cases from the scraper's own AI response cache
//   run       replay cases against an endpoint, score, write a result file
//   compare   diff two or more result files into a decision table
//   rescore   re-run the current scorers over a saved result file (no GPU)
//   bless     show a case so its `expected` can be filled in by hand
//
// Examples
//   node tools/ai-eval.js harvest --per-pass 6
//   node tools/ai-eval.js run --model lmstudio-community/Qwen3-Coder-Next-MLX-6bit --label baseline
//   node tools/ai-eval.js run --model qwen3.8-27b-4bit --label 3.8-27b --bias
//   node tools/ai-eval.js compare ai-eval-results/baseline.json ai-eval-results/3.8-27b.json
//
// The eval needs a live GPU server, so it is a CLI and never part of `npm test`
// — scripts/ai-eval.test.js covers the scoring logic offline instead.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ev = require('../scripts/ai-eval.js');

const ROOT = path.resolve(__dirname, '..');
const CASES_DIR = path.join(ROOT, 'scripts', 'fixtures', 'ai-eval');
const RESULTS_DIR = path.join(ROOT, 'ai-eval-results');
const DEFAULT_STORAGE = path.join(
    process.env.HOME || '',
    'Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/chunky-dad-scraper/storage'
);

const TEXT_ENDPOINT = 'http://rybook.taila7523c.ts.net:8000/v1/chat/completions';
const VISION_ENDPOINT = 'http://rybook.taila7523c.ts.net:8001/v1/chat/completions';

// The cache stores the vision pass under 'ocr-all'; everything else is 1:1.
const CACHE_DIR_FOR_PASS = { 'ocr': 'ocr-all' };

function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token.startsWith('--')) {
            const key = token.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) { args[key] = true; }
            else { args[key] = next; i += 1; }
        } else {
            args._.push(token);
        }
    }
    return args;
}

// ---------------------------------------------------------------------------
// harvest
// ---------------------------------------------------------------------------

// Stratify by the first URL host in the prompt so one busy site cannot
// dominate a pass's cases. Deterministic: entries are sorted before sampling,
// so re-harvesting produces the same set.
function hostFromPrompt(prompt) {
    const m = /https?:\/\/([^/\s"')]+)/i.exec(String(prompt));
    return m ? m[1].replace(/^www\./i, '').toLowerCase() : 'unknown';
}

function roundRobinByHost(entries, limit) {
    const buckets = new Map();
    for (const entry of entries) {
        const host = entry.host || 'unknown';
        if (!buckets.has(host)) buckets.set(host, []);
        buckets.get(host).push(entry);
    }
    const hosts = [...buckets.keys()].sort();
    // Newest first WITHIN each host. Prompts change over time and the cache
    // never evicts the old shape, so an id-ordered sample happily picks
    // entries production can no longer produce — the field-trim pass alone has
    // two shapes in the cache, months apart. Recency keeps cases live; the
    // host round-robin still stops one busy site dominating.
    for (const host of hosts) {
        buckets.get(host).sort((a, b) =>
            String(b.cachedAt || '').localeCompare(String(a.cachedAt || '')) || a.id.localeCompare(b.id));
    }
    const picked = [];
    let cursor = 0;
    while (picked.length < limit) {
        let took = false;
        for (const host of hosts) {
            if (picked.length >= limit) break;
            const bucket = buckets.get(host);
            if (bucket.length > cursor) { picked.push(bucket[cursor]); took = true; }
        }
        if (!took) break;
        cursor += 1;
    }
    return picked;
}

function downscaleToJpeg(buffer, maxDimension) {
    // Same ladder the Node adapter uses for OCR images: sharp when present,
    // macOS sips otherwise, original bytes as the last resort.
    try {
        const sharp = require('sharp');
        return { buffer: null, promise: sharp(buffer).rotate()
            .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 }).toBuffer() };
    } catch (_) { /* sharp not installed */ }
    try {
        const tmpIn = path.join(require('os').tmpdir(), 'ai-eval-in-' + Date.now() + '.img');
        const tmpOut = path.join(require('os').tmpdir(), 'ai-eval-out-' + Date.now() + '.jpg');
        fs.writeFileSync(tmpIn, buffer);
        execFileSync('/usr/bin/sips', ['-Z', String(maxDimension), '-s', 'format', 'jpeg',
            '-s', 'formatOptions', '85', tmpIn, '--out', tmpOut], { stdio: 'ignore' });
        const out = fs.readFileSync(tmpOut);
        fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut);
        return { buffer: out, promise: null };
    } catch (_) { /* sips unavailable */ }
    return { buffer, promise: null };
}

async function harvest(args) {
    const storage = args.storage || process.env.CHUNKY_SHARED_STORAGE_DIR || DEFAULT_STORAGE;
    const outDir = args.out || CASES_DIR;
    const perPass = Number(args['per-pass']) || 6;
    const wanted = args.passes ? String(args.passes).split(',') : ev.PASSES;

    if (!fs.existsSync(storage)) {
        console.error('Storage dir not found: ' + storage);
        console.error('Pass --storage <dir> or set CHUNKY_SHARED_STORAGE_DIR.');
        process.exit(1);
    }

    let written = 0;
    let skippedUnparseable = 0;

    for (const pass of wanted) {
        const entries = [];
        if (pass === 'ocr') {
            const ocrRoot = path.join(storage, 'ocr');
            if (!fs.existsSync(ocrRoot)) continue;
            for (const host of fs.readdirSync(ocrRoot)) {
                const hostDir = path.join(ocrRoot, host);
                if (!fs.statSync(hostDir).isDirectory()) continue;
                for (const file of fs.readdirSync(hostDir)) {
                    if (!file.endsWith('.json')) continue;
                    let entry;
                    try { entry = JSON.parse(fs.readFileSync(path.join(hostDir, file), 'utf8')); }
                    catch (_) { continue; }
                    if (!entry.request || !entry.request.prompt || !entry.response) continue;
                    entries.push({
                        id: file.replace(/\.json$/, ''),
                        host,
                        prompt: entry.request.prompt,
                        model: entry.request.model,
                        responseText: entry.response.text,
                        cachedAt: entry.cachedAt,
                        url: entry.url,
                        imagePixels: entry.imagePixels
                    });
                }
            }
        } else {
            const dirName = CACHE_DIR_FOR_PASS[pass] || pass;
            const passDir = path.join(storage, 'ai-responses', dirName);
            if (!fs.existsSync(passDir)) continue;
            for (const file of fs.readdirSync(passDir)) {
                if (!file.endsWith('.json')) continue;
                let entry;
                try { entry = JSON.parse(fs.readFileSync(path.join(passDir, file), 'utf8')); }
                catch (_) { continue; }
                if (!entry.request || !entry.request.prompt || !entry.response) continue;
                entries.push({
                    id: file.replace(/\.json$/, ''),
                    host: hostFromPrompt(entry.request.prompt),
                    prompt: entry.request.prompt,
                    model: entry.request.model,
                    options: entry.request.options,
                    responseText: entry.response.text,
                    cachedAt: entry.cachedAt
                });
            }
        }

        // A baseline that does not parse is a TRUNCATED answer from the old
        // model, not truth — production salvages text out of those and loses
        // the classification. They are excluded from cases; the live
        // truncation rate is measured during `run` instead.
        const usable = entries.filter(entry => {
            const parsed = ev.parseJsonLoose(entry.responseText, null);
            if (!parsed.ok) { skippedUnparseable += 1; return false; }
            return true;
        });

        const picked = roundRobinByHost(usable, perPass);
        const passOut = path.join(outDir, pass);
        fs.mkdirSync(passOut, { recursive: true });

        for (const entry of picked) {
            const kase = {
                id: pass + '/' + entry.id,
                pass,
                prompt: entry.prompt,
                options: {
                    numPredict: (entry.options && entry.options.numPredict) || ev.PASS_NUM_PREDICT[pass],
                    temperature: 0,
                    responseFormat: (entry.options && entry.options.responseFormat) || 'json_object'
                },
                baseline: {
                    model: entry.model,
                    text: entry.responseText,
                    cachedAt: entry.cachedAt
                },
                expected: null,
                blessed: 'auto'
            };
            if (pass === 'ocr' && entry.url) {
                kase.sourceUrl = entry.url;
                const imageName = entry.id + '.jpg';
                const imagePath = path.join(outDir, 'images', imageName);
                if (!fs.existsSync(imagePath)) {
                    try {
                        const res = await fetch(entry.url, { signal: AbortSignal.timeout(30000) });
                        if (!res.ok) throw new Error('HTTP ' + res.status);
                        const raw = Buffer.from(await res.arrayBuffer());
                        const scaled = downscaleToJpeg(raw, 1024);
                        const bytes = scaled.promise ? await scaled.promise : scaled.buffer;
                        fs.mkdirSync(path.dirname(imagePath), { recursive: true });
                        fs.writeFileSync(imagePath, bytes);
                    } catch (err) {
                        console.warn('  ! image unavailable for ' + entry.id + ': ' + err.message + ' (case skipped)');
                        continue;
                    }
                }
                kase.image = path.join('images', imageName);
            }
            fs.writeFileSync(path.join(passOut, entry.id + '.json'), JSON.stringify(kase, null, 2) + '\n');
            written += 1;
        }
        console.log('  ' + pass.padEnd(20) + String(picked.length).padStart(3) + ' cases from '
            + usable.length + ' usable / ' + entries.length + ' cached');
    }
    console.log('\n' + written + ' cases written to ' + outDir);
    if (skippedUnparseable > 0) {
        console.log(skippedUnparseable + ' cached entries skipped (unparseable/truncated baseline)');
    }
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

async function callModel(endpoint, payload, timeoutSeconds) {
    const started = Date.now();
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout((Number(timeoutSeconds) || 180) * 1000)
        });
        const latencyMs = Date.now() - started;
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            return { error: 'HTTP ' + res.status + ' ' + body.slice(0, 200), latencyMs };
        }
        const body = await res.json();
        const choice = body.choices && body.choices[0];
        return {
            text: choice && choice.message ? choice.message.content : null,
            finishReason: choice ? choice.finish_reason : null,
            promptTokens: body.usage ? body.usage.prompt_tokens : 0,
            completionTokens: body.usage ? body.usage.completion_tokens : 0,
            latencyMs
        };
    } catch (err) {
        return { error: err.message, latencyMs: Date.now() - started };
    }
}

async function mapWithLimit(items, limit, task) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await task(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

async function run(args) {
    const model = args.model;
    if (!model) { console.error('--model is required'); process.exit(1); }
    const label = args.label || model.replace(/[^A-Za-z0-9._-]/g, '_');
    const casesDir = args.cases || CASES_DIR;
    const passes = args.passes ? String(args.passes).split(',') : null;
    const concurrency = Number(args.concurrency) || 1;
    const timeoutSeconds = Number(args.timeout) || 180;
    const textEndpoint = args.endpoint || TEXT_ENDPOINT;
    const visionEndpoint = args['vision-endpoint'] || VISION_ENDPOINT;
    const visionModel = args['vision-model'] || model;

    let cases = ev.loadCases(casesDir, { passes });
    if (args.limit) cases = cases.slice(0, Number(args.limit));
    if (cases.length === 0) {
        console.error('No cases found in ' + casesDir + ' — run `harvest` first.');
        process.exit(1);
    }

    const gates = ev.createGates();
    console.log('\nRunning ' + cases.length + ' cases against ' + model + ' (concurrency ' + concurrency + ')');

    const rows = await mapWithLimit(cases, concurrency, async (kase) => {
        const isVision = Boolean(kase.image);
        const payload = ev.buildPayload(kase, { model: isVision ? visionModel : model });
        const res = await callModel(isVision ? visionEndpoint : textEndpoint, payload, timeoutSeconds);
        if (res.error) {
            return { id: kase.id, pass: kase.pass, error: res.error, latencyMs: res.latencyMs,
                jsonOk: false, accepted: false, agreement: null };
        }
        const scored = ev.scoreCase(kase, res.text, gates);
        delete scored.parsed;
        return {
            ...scored,
            // Kept so `rescore` can re-run a corrected scorer over an existing
            // result file. Scoring bugs are common (six were found while
            // building this) and re-running a model to fix one is pure waste.
            responseText: res.text,
            latencyMs: res.latencyMs,
            finishReason: res.finishReason,
            promptTokens: res.promptTokens,
            completionTokens: res.completionTokens
        };
    });

    // Position bias: re-run every arbitration case with the two candidate
    // values swapped. Choosing by content survives the swap; choosing by slot
    // does not. Needs no golden data, which is why it is worth always running.
    let bias = null;
    if (args.bias) {
        const arbCases = cases.filter(c => c.pass === 'merge-arbitration');
        if (arbCases.length > 0) {
            console.log('Position-bias probe: re-running ' + arbCases.length + ' arbitration cases with swapped slots');
            const pairs = await mapWithLimit(arbCases, concurrency, async (kase) => {
                const swapped = { ...kase, prompt: ev.swapArbitrationPrompt(kase.prompt) };
                const res = await callModel(textEndpoint, ev.buildPayload(swapped, { model }), timeoutSeconds);
                if (res.error) return null;
                const original = rows.find(r => r.id === kase.id);
                const swappedScored = ev.scoreCase(swapped, res.text, gates);
                return { original, swapped: swappedScored };
            });
            bias = ev.positionBiasRate(pairs.filter(Boolean));
        }
    }

    const summary = ev.aggregate(rows);
    console.log(ev.formatSummaryTable(summary, label + '  —  ' + model));
    if (bias && bias.rate !== null) {
        console.log('  position bias: ' + bias.flipped + '/' + bias.compared + ' picks flipped when the slots were swapped ('
            + (bias.rate * 100).toFixed(1) + '%) — 0% means the model reads content, not position\n');
    }

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const outPath = path.join(RESULTS_DIR, label + '.json');
    fs.writeFileSync(outPath, JSON.stringify({
        label, model, visionModel, endpoint: textEndpoint, visionEndpoint,
        concurrency, ranAt: new Date().toISOString(),
        summary, bias, rows
    }, null, 2) + '\n');
    console.log('  -> ' + path.relative(ROOT, outPath) + '\n');
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

function compare(args) {
    const files = args._.slice(1);
    if (files.length < 2) { console.error('compare needs two or more result files'); process.exit(1); }
    const results = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
    const passes = [...new Set(results.flatMap(r => r.summary.map(s => s.pass)))]
        .sort((a, b) => ev.PASSES.indexOf(a) - ev.PASSES.indexOf(b));

    const metrics = [
        ['accept%', s => s.acceptRate === null ? null : s.acceptRate * 100],
        ['agree%', s => s.agreementMean === null ? null : s.agreementMean * 100],
        ['p50ms', s => s.latencyP50],
        ['yield (fields/case)', s => s.yieldMean || null]
    ];

    for (const [name, pick] of metrics) {
        console.log('\n  ' + name);
        console.log('  ' + '-'.repeat(24 + results.length * 14));
        console.log('  ' + 'pass'.padEnd(22) + results.map(r => r.label.slice(0, 12).padStart(13)).join(''));
        for (const pass of passes) {
            const cells = results.map(r => {
                const row = r.summary.find(s => s.pass === pass);
                if (!row) return '-'.padStart(13);
                const value = pick(row);
                return value === null ? '-'.padStart(13) : value.toFixed(1).padStart(13);
            });
            console.log('  ' + pass.padEnd(22) + cells.join(''));
        }
    }

    console.log('\n  totals');
    console.log('  ' + '-'.repeat(24 + results.length * 14));
    console.log('  ' + 'model time (s)'.padEnd(22)
        + results.map(r => (r.summary.reduce((a, s) => a + s.wallMs, 0) / 1000).toFixed(1).padStart(13)).join(''));
    console.log('  ' + 'invented values'.padEnd(22)
        + results.map(r => String(r.summary.reduce((a, s) => a + s.inventedFields + s.fabricatedQuotes + s.strayBoundaries, 0)).padStart(13)).join(''));
    console.log('  ' + 'position bias %'.padEnd(22)
        + results.map(r => (r.bias && r.bias.rate !== null && r.bias.rate !== undefined
            ? (r.bias.rate * 100).toFixed(1) : '-').padStart(13)).join(''));
    console.log('');
}

// ---------------------------------------------------------------------------
// bless
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// rescore — re-run the current scorers over a saved result file
// ---------------------------------------------------------------------------

function rescore(args) {
    const files = args._.slice(1);
    if (files.length === 0) { console.error('rescore needs at least one result file'); process.exit(1); }
    const gates = ev.createGates();
    for (const file of files) {
        const result = JSON.parse(fs.readFileSync(file, 'utf8'));
        const cases = new Map(ev.loadCases(args.cases || CASES_DIR).map(c => [c.id, c]));
        let rescored = 0;
        let missingText = 0;
        result.rows = result.rows.map(row => {
            const kase = cases.get(row.id);
            if (!kase || typeof row.responseText !== 'string') {
                if (!row.error) missingText += 1;
                return row;
            }
            const scored = ev.scoreCase(kase, row.responseText, gates);
            delete scored.parsed;
            rescored += 1;
            return { ...row, ...scored };
        });
        result.summary = ev.aggregate(result.rows);
        result.rescoredAt = new Date().toISOString();
        fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
        console.log(ev.formatSummaryTable(result.summary, result.label + '  —  ' + result.model + '  (rescored)'));
        console.log('  ' + rescored + ' rows rescored'
            + (missingText > 0 ? ', ' + missingText + ' skipped (no stored response — re-run to capture it)' : ''));
    }
}

function bless(args) {
    const casesDir = args.cases || CASES_DIR;
    const cases = ev.loadCases(casesDir, { passes: args.passes ? String(args.passes).split(',') : null });
    const target = args._[1];
    if (!target) {
        const byState = { auto: [], human: [] };
        for (const kase of cases) (byState[kase.blessed] || byState.auto).push(kase.id);
        console.log('\n  ' + byState.human.length + ' blessed by hand, ' + byState.auto.length + ' still baseline-only\n');
        for (const id of byState.auto) console.log('    ' + id);
        console.log('\n  Show one with:  node tools/ai-eval.js bless <id>\n');
        return;
    }
    const kase = cases.find(c => c.id === target || c.id.endsWith('/' + target));
    if (!kase) { console.error('No case matching ' + target); process.exit(1); }
    console.log('\n=== ' + kase.id + ' (' + kase.pass + ') ===\n');
    console.log('--- PROMPT ---\n' + kase.prompt);
    console.log('\n--- BASELINE (' + kase.baseline.model + ', ' + kase.baseline.cachedAt + ') ---\n' + kase.baseline.text);
    console.log('\nTo bless: edit ' + path.join(casesDir, kase.pass, kase.id.split('/')[1] + '.json'));
    console.log('  set "expected" to the correct answer and "blessed" to "human".\n');
}

// ---------------------------------------------------------------------------

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const command = args._[0];
    if (command === 'harvest') return harvest(args);
    if (command === 'run') return run(args);
    if (command === 'compare') return compare(args);
    if (command === 'rescore') return rescore(args);
    if (command === 'bless') return bless(args);
    console.log(fs.readFileSync(__filename, 'utf8').split('\n')
        .filter(l => l.startsWith('//')).slice(1, 18).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}

if (require.main === module) {
    main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { parseArgs, hostFromPrompt, roundRobinByHost };

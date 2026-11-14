// scripts/scraper-bars.js and data/scraper-bars.json are built from
// data/bars/*.json. The runtime reads the built copy, so a bar added to
// data/bars without rebuilding never reaches a run (Icon DC, 2026-11-14).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

test('generated bars files match data/bars', () => {
    const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'generate-scraper-bars.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(run.status, 0, `${run.stderr || run.stdout}`.trim());
});

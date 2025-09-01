#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const SITE_BASE = 'https://chunky.dad';
const OUTPUT_DIR = path.join(ROOT, 'img', 'og');

// Lazy-load puppeteer only when invoked in CI to keep local fast
async function getPuppeteer() {
  try {
    return await import('puppeteer');
  } catch (e) {
    console.error('Puppeteer is required to generate images. Ensure it is installed.');
    throw e;
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeIfChanged(filePath, buffer) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    if (Buffer.compare(existing, buffer) === 0) return false;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buffer);
  return true;
}

function sanitize(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Build a minimal HTML snippet (no external CSS/fonts) for deterministic render
function buildTemplate({ cityName, eventName, day, time, bar }) {
  const title = sanitize(eventName);
  const subtitle = [sanitize(cityName), sanitize(day), sanitize(time)].filter(Boolean).join(' • ');
  const venue = bar ? `@ ${sanitize(bar)}` : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body { margin: 0; padding: 0; width: 1200px; height: 630px; }
    body {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      background: linear-gradient(135deg, #10151a 0%, #1c2833 100%);
      color: #fff;
    }
    .card { width: 1080px; height: 510px; border-radius: 24px; padding: 48px; background: rgba(255,255,255,0.06); box-shadow: 0 20px 60px rgba(0,0,0,0.4); display: flex; flex-direction: column; justify-content: center; }
    .brand { font-weight: 700; letter-spacing: 0.6px; color: #f8f9fa; opacity: 0.9; margin-bottom: 18px; }
    .title { font-size: 64px; line-height: 1.05; font-weight: 800; margin: 0 0 18px; }
    .subtitle { font-size: 28px; color: #d0d7de; margin: 0 0 8px; }
    .venue { font-size: 28px; color: #e6edf3; margin: 0; }
  </style>
  <title>${title}</title>
  </head>
  <body>
    <div class="card">
      <div class="brand">chunky.dad</div>
      <div class="title">${title}</div>
      <div class="subtitle">${subtitle}</div>
      ${venue ? `<div class="venue">${venue}</div>` : ''}
    </div>
  </body>
</html>`;
}

async function main() {
  // Load config and events by reading generated event stub pages
  // Source of truth for which events need images: directories under each city with index.html
  const cityDirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory());
  const targets = [];

  for (const dir of cityDirs) {
    const cityKey = dir.name;
    // Skip non-city directories
    const indexHtml = path.join(ROOT, cityKey, 'index.html');
    if (!fs.existsSync(indexHtml)) continue;

    const eventDirs = fs.readdirSync(path.join(ROOT, cityKey), { withFileTypes: true }).filter(d => d.isDirectory());
    for (const evDir of eventDirs) {
      const evIndex = path.join(ROOT, cityKey, evDir.name, 'index.html');
      if (!fs.existsSync(evIndex)) continue;
      const html = fs.readFileSync(evIndex, 'utf8');
      // Only generate when og:image is not already a per-event PNG under /img/og/
      const hasGenerated = html.includes(`/img/og/${cityKey}/${evDir.name}.png`);
      if (hasGenerated) continue;

      // Extract minimal data from title/description for rendering
      const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
      const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
      const cityFromCanonical = (html.match(/<link rel="canonical" href="\/([^/]+)\//) || [])[1] || cityKey;
      const title = titleMatch ? titleMatch[1] : `${cityKey} event`;
      const desc = descMatch ? descMatch[1] : '';
      let day = '', time = '', bar = '';
      if (desc) {
        // Attempt to split: City • Day • Time · @ Venue
        const parts = desc.split(' · ');
        const primary = parts[0] || '';
        const pbits = primary.split(' • ');
        // title format used earlier: <Event> – <City> – chunky.dad
        // desc format: Day · Time · @ Bar (if present)
        if (pbits.length >= 2) {
          // Might be City • Day • Time or Day • Time; prefer last two as day/time
          day = pbits[pbits.length - 2] || '';
          time = pbits[pbits.length - 1] || '';
        }
        const venuePart = parts.find(p => p.startsWith('@ '));
        if (venuePart) bar = venuePart.replace(/^@\s*/, '');
      }
      targets.push({ cityKey: cityFromCanonical, slug: evDir.name, title, day, time, bar });
    }
  }

  if (targets.length === 0) {
    console.log('No OG images to generate.');
    return;
  }

  const { default: puppeteer } = await getPuppeteer();
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let changes = 0;
  try {
    for (const t of targets) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
      const html = buildTemplate({ cityName: t.cityKey, eventName: t.title, day: t.day, time: t.time, bar: t.bar });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const buffer = await page.screenshot({ type: 'png' });
      const outPath = path.join(OUTPUT_DIR, t.cityKey, `${t.slug}.png`);
      if (writeIfChanged(outPath, buffer)) {
        changes++;
        console.log(`✓ Generated ${path.relative(ROOT, outPath)}`);
      } else {
        console.log(`⏭️  No change for ${path.relative(ROOT, outPath)}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  if (changes === 0) {
    console.log('No OG image changes.');
  } else {
    console.log(`OG image generation complete. ${changes} change(s).`);
  }
}

main().catch(err => {
  console.error('Fatal error generating OG images:', err);
  process.exit(1);
});


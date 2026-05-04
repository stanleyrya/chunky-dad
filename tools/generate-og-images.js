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

/**
 * Load bar favicon colors indexed by bar name (lower-cased) for a given city.
 * Returns a Map<string, { bg: string, fg: string }>.
 */
function loadBarColors(cityKey) {
  const barsFile = path.join(ROOT, 'data', 'bars', `${cityKey}.json`);
  if (!fs.existsSync(barsFile)) return new Map();
  try {
    const bars = JSON.parse(fs.readFileSync(barsFile, 'utf8'));
    const map = new Map();
    for (const bar of bars) {
      if (bar.name && bar.faviconBg) {
        map.set(bar.name.toLowerCase(), { bg: bar.faviconBg, fg: bar.faviconFg || '#ffffff' });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Mix a hex color with black by the given ratio (0–1 = proportion of black).
 * ratio=0.6 means 60% black + 40% original color.
 * Used to create a dark readable background from a brand color.
 */
function darken(hex, ratio = 0.6) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * (1 - ratio));
  const dg = Math.round(g * (1 - ratio));
  const db = Math.round(b * (1 - ratio));
  return `#${[dr, dg, db].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Build a minimal HTML snippet (no external CSS/fonts) for deterministic render.
// When faviconColors is provided the OG card uses the bar's brand palette.
function buildTemplate({ cityName, eventName, day, time, bar, faviconColors }) {
  const title = sanitize(eventName);
  const subtitle = [sanitize(cityName), sanitize(day), sanitize(time)].filter(Boolean).join(' • ');
  const venue = bar ? `@ ${sanitize(bar)}` : '';

  // Derive background and accent from favicon colors when available
  const bgGrad = faviconColors
    ? `linear-gradient(135deg, ${darken(faviconColors.bg, 0.65)} 0%, ${darken(faviconColors.bg, 0.45)} 100%)`
    : 'linear-gradient(135deg, #10151a 0%, #1c2833 100%)';
  const accentColor = faviconColors ? faviconColors.bg : '#667eea';
  const cardBg = faviconColors
    ? `rgba(255,255,255,0.08)`
    : 'rgba(255,255,255,0.06)';
  const cardBorder = faviconColors
    ? `border-left: 6px solid ${faviconColors.bg};`
    : '';

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
      background: ${bgGrad};
      color: #fff;
    }
    .card { width: 1080px; height: 510px; border-radius: 24px; padding: 48px; background: ${cardBg}; box-shadow: 0 20px 60px rgba(0,0,0,0.4); display: flex; flex-direction: column; justify-content: center; ${cardBorder} }
    .brand { font-weight: 700; letter-spacing: 0.6px; color: ${accentColor}; opacity: 0.95; margin-bottom: 18px; }
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

    // Load bar favicon colors for this city (keyed by lower-cased bar name)
    const barColors = loadBarColors(cityKey);

    const eventDirs = fs.readdirSync(path.join(ROOT, cityKey), { withFileTypes: true }).filter(d => d.isDirectory());
    for (const evDir of eventDirs) {
      const evIndex = path.join(ROOT, cityKey, evDir.name, 'index.html');
      if (!fs.existsSync(evIndex)) continue;
      const html = fs.readFileSync(evIndex, 'utf8');

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

      // Look up favicon colors for the venue (if known)
      const faviconColors = bar ? barColors.get(bar.toLowerCase()) || null : null;

      targets.push({ cityKey: cityFromCanonical, slug: evDir.name, title, day, time, bar, faviconColors });
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
      const html = buildTemplate({ cityName: t.cityKey, eventName: t.title, day: t.day, time: t.time, bar: t.bar, faviconColors: t.faviconColors });
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


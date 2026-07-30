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

// Default background color used when no favicon palette is available (matches gradient end stop).
const DEFAULT_DARK_BG = '#1c2833';
// Gradient darkening ratios: darker stop → lighter stop for a subtle gradient.
const GRADIENT_DARK_RATIO  = 0.65;
const GRADIENT_LIGHT_RATIO = 0.45;

/**
 * Load event favicon colors for a city, keyed by event slug.
 * Returns a Map<string, { bg: string, fg: string }>.
 */
function loadEventColors(cityKey) {
  const colorsFile = path.join(ROOT, 'data', 'event-colors', `${cityKey}.json`);
  if (!fs.existsSync(colorsFile)) return new Map();
  try {
    const entries = JSON.parse(fs.readFileSync(colorsFile, 'utf8'));
    const map = new Map();
    for (const entry of entries) {
      if (entry.slug && entry.faviconBg) {
        map.set(entry.slug, { bg: entry.faviconBg, fg: entry.faviconFg || '#ffffff' });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Load bar favicon colors for a city, keyed by lower-cased bar name.
 * Used as a fallback when an event has no extracted colors of its own.
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
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return DEFAULT_DARK_BG;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * (1 - ratio));
  const dg = Math.round(g * (1 - ratio));
  const db = Math.round(b * (1 - ratio));
  return `#${[dr, dg, db].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// Undo the entity escaping generate-event-pages.js applies to meta content.
function unescapeMeta(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Build a minimal HTML snippet (no external CSS/fonts) for deterministic render.
// When faviconColors is provided the OG card uses the event's extracted favicon palette.
// When flyerUrl is provided the event's own artwork is painted (dimmed and
// blurred behind, whole and uncropped beside the text). Every flyer path is
// opt-in and self-healing: if the image fails to load the page drops back to
// the text-only card that has always been generated, via the body class.
function buildTemplate({ cityName, eventName, day, time, bar, faviconColors, flyerUrl }) {
  const title = sanitize(eventName);
  const subtitle = [sanitize(cityName), sanitize(day), sanitize(time)].filter(Boolean).join(' • ');
  const venue = bar ? `@ ${sanitize(bar)}` : '';
  const flyer = /^https?:\/\//i.test(String(flyerUrl || '').trim())
    ? sanitize(String(flyerUrl).trim()).replace(/"/g, '&quot;')
    : '';

  // Derive background and accent from favicon colors when available
  const bgGrad = faviconColors
    ? `linear-gradient(135deg, ${darken(faviconColors.bg, GRADIENT_DARK_RATIO)} 0%, ${darken(faviconColors.bg, GRADIENT_LIGHT_RATIO)} 100%)`
    : `linear-gradient(135deg, #10151a 0%, ${DEFAULT_DARK_BG} 100%)`;
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
    /* Flyer layers: inert unless body.has-flyer, which the images themselves
       clear when they fail to load. */
    .flyer-bg, .flyer-art { display: none; }
    body.has-flyer .flyer-bg { display: block; position: absolute; inset: 0; overflow: hidden; }
    body.has-flyer .flyer-bg img { width: 100%; height: 100%; object-fit: cover; filter: blur(26px) brightness(0.42) saturate(1.1); transform: scale(1.1); }
    body.has-flyer .stage { position: relative; display: flex; align-items: center; gap: 40px; }
    body.has-flyer .card { width: 620px; height: 470px; }
    body.has-flyer .title { font-size: 52px; }
    body.has-flyer .flyer-art { display: flex; align-items: center; justify-content: center; width: 400px; height: 510px; }
    body.has-flyer .flyer-art img { max-width: 400px; max-height: 510px; object-fit: contain; border-radius: 16px; box-shadow: 0 18px 50px rgba(0,0,0,0.55); }
  </style>
  <title>${title}</title>
  </head>
  <body class="${flyer ? 'has-flyer' : ''}">
    ${flyer ? `<div class="flyer-bg"><img src="${flyer}" onerror="document.body.className=''"></div>` : ''}
    <div class="stage">
    <div class="card">
      <div class="brand">chunky.dad</div>
      <div class="title">${title}</div>
      <div class="subtitle">${subtitle}</div>
      ${venue ? `<div class="venue">${venue}</div>` : ''}
    </div>
    ${flyer ? `<div class="flyer-art"><img src="${flyer}" onerror="document.body.className=''"></div>` : ''}
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

    // Load favicon colors — event colors are primary, bar colors are fallback
    const eventColors = loadEventColors(cityKey);
    const barColors   = loadBarColors(cityKey);

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

      // Look up favicon colors: prefer event-specific, fall back to the venue bar's colors
      const faviconColors = eventColors.get(evDir.name)
        || (bar ? barColors.get(bar.toLowerCase()) : null)
        || null;

      // The event's flyer, written into the stub by generate-event-pages.js
      // (landscape candidate preferred — this artboard is 1200×630).
      const flyerMatch = html.match(/<meta name="chunky:flyer" content="([^"]+)"/);
      const flyerUrl = flyerMatch ? unescapeMeta(flyerMatch[1]) : '';

      targets.push({ cityKey: cityFromCanonical, slug: evDir.name, title, day, time, bar, faviconColors, flyerUrl });
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
      let page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
      const baseArgs = { cityName: t.cityKey, eventName: t.title, day: t.day, time: t.time, bar: t.bar, faviconColors: t.faviconColors };
      let rendered = false;
      try {
        await page.setContent(buildTemplate({ ...baseArgs, flyerUrl: t.flyerUrl }), { waitUntil: 'networkidle0', timeout: 20000 });
        rendered = true;
      } catch (err) {
        // A slow or unreachable flyer host must never fail the build: fall back
        // to the text-only card, which needs no network at all.
        console.warn(`⚠️  Flyer render timed out for ${t.cityKey}/${t.slug}; using text-only card`);
      }
      if (!rendered) {
        // The fallback needs its OWN guard. It previously ran inside the catch
        // above with no timeout override, so it inherited the 30s default and,
        // when it also hung, its throw escaped the very catch meant to make it
        // safe — aborting the whole job (observed in CI 2026-07-30, run
        // 30563792651, after one slow CDN). It also renders in a page whose
        // previous load was just aborted, so it gets a fresh one, waits only
        // for domcontentloaded (no network is involved in a text-only card),
        // and skips this event entirely rather than failing the run.
        try {
          await page.close().catch(() => {});
          page = await browser.newPage();
          await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
          await page.setContent(buildTemplate(baseArgs), { waitUntil: 'domcontentloaded', timeout: 15000 });
          rendered = true;
        } catch (fallbackError) {
          console.warn(`⚠️  Skipping OG image for ${t.cityKey}/${t.slug}: ${fallbackError.message}`);
        }
      }
      if (rendered) {
        const buffer = await page.screenshot({ type: 'png' });
        const outPath = path.join(OUTPUT_DIR, t.cityKey, `${t.slug}.png`);
        if (writeIfChanged(outPath, buffer)) {
          changes++;
          console.log(`✓ Generated ${path.relative(ROOT, outPath)}`);
        } else {
          console.log(`⏭️  No change for ${path.relative(ROOT, outPath)}`);
        }
      }
      await page.close().catch(() => {});
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


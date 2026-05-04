#!/usr/bin/env node

/**
 * Extract two dominant colors (background + foreground/symbol) from favicons.
 *
 * For every URL supplied (from bars or events) the favicon is actually fetched
 * from the page, decoded with sharp, and the two most dominant opaque colors
 * are found via k-means (k=2) on raw RGBA pixels.  There are no hardcoded
 * platform shortcut colors — every URL is treated the same way.
 *
 * Bars:   results written to data/bars/<city>.json as `faviconBg` / `faviconFg`.
 * Events: results written to data/event-colors/<city>.json as
 *         [{ slug, url, faviconBg, faviconFg }, …].
 *
 * Usage:
 *   node tools/extract-favicon-colors.js [options]
 *
 * Options:
 *   --bars            Process bars only
 *   --events          Process events only
 *   (default: both)
 *   --force           Re-extract even if colors already present
 *   --city <city>     Only process the given city
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const ROOT            = path.resolve(__dirname, '..');
const BARS_DIR        = path.join(ROOT, 'data', 'bars');
const EVENT_COLORS_DIR = path.join(ROOT, 'data', 'event-colors');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const FORCE      = args.includes('--force');
const ONLY_BARS  = args.includes('--bars');
const ONLY_EVENTS = args.includes('--events');
const DO_BARS    = !ONLY_EVENTS;
const DO_EVENTS  = !ONLY_BARS;
const cityFilter = (() => {
  const idx = args.indexOf('--city');
  return idx !== -1 ? args[idx + 1] : null;
})();

// ---------------------------------------------------------------------------
// HTTP fetch helpers
// ---------------------------------------------------------------------------

/** Fetch a URL, following up to maxRedirects redirects. Returns Buffer. */
function fetchBuffer(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch (e) { return reject(new Error(`Invalid URL: ${url}`)); }
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FaviconColorExtractor/1.0)',
        'Accept': 'image/*,*/*;q=0.8',
      },
      timeout: 10000,
    };
    const req = lib.request(options, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        try {
          const redirectUrl = new URL(res.headers.location, url).toString();
          resolve(fetchBuffer(redirectUrl, maxRedirects - 1));
        } catch (e) {
          reject(new Error(`Bad redirect URL: ${res.headers.location}`));
        }
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
    req.end();
  });
}

/** Fetch HTML text for a URL. */
async function fetchText(url) {
  const buf = await fetchBuffer(url);
  return buf.toString('utf8');
}

// ---------------------------------------------------------------------------
// Favicon URL discovery
// ---------------------------------------------------------------------------

/** Extract the best favicon URL from an HTML page. */
function parseFaviconFromHtml(html, baseUrl) {
  // Collect all <link rel="…icon…"> entries (including apple-touch-icon, mask-icon, etc.)
  const iconPattern = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const candidates = [];
  let m;
  while ((m = iconPattern.exec(html)) !== null) {
    candidates.push(m[1]);
  }
  // Prefer PNG over SVG over ICO for better color extraction
  const png = candidates.find(c => /\.png(\?|$)/i.test(c));
  const svg = candidates.find(c => /\.svg(\?|$)/i.test(c));
  const ico = candidates.find(c => /\.ico(\?|$)/i.test(c));
  const chosen = png || ico || svg || candidates[0];
  if (!chosen) return null;
  try {
    return new URL(chosen, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Find the best favicon URL for a given page URL.
 * Strategy: try /favicon.ico, then parse HTML for <link rel="icon">.
 */
async function resolveFaviconUrl(pageUrl) {
  let origin;
  try { origin = new URL(pageUrl).origin; } catch { return null; }
  const icoUrl = `${origin}/favicon.ico`;

  // Try the fallback /favicon.ico first (cheap)
  try {
    const buf = await fetchBuffer(icoUrl);
    if (buf.length > 100) return icoUrl; // ignore empty / trivial responses
  } catch {
    // ignore
  }

  // Parse the actual page HTML for a declared icon
  try {
    const html = await fetchText(pageUrl);
    const found = parseFaviconFromHtml(html, pageUrl);
    if (found) return found;
  } catch {
    // ignore
  }

  return null;
}

// ---------------------------------------------------------------------------
// Color extraction using sharp
// ---------------------------------------------------------------------------

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('sharp is required. Run: npm install sharp');
  process.exit(1);
}

/**
 * Simple k-means (k=2) on RGB pixels.
 * Returns the two cluster centroids as hex strings:
 *   [0] = larger cluster (background)
 *   [1] = smaller cluster (foreground / symbol)
 */
function kMeans2(pixels, maxIter = 20) {
  if (pixels.length < 2) return ['#000000', '#ffffff'];

  // Initialize: c1 = first pixel, c2 = farthest pixel from c1
  let c1 = pixels[0];
  let maxDist = -1;
  let c2 = pixels[0];
  for (const p of pixels) {
    const d = colorDist(p, c1);
    if (d > maxDist) { maxDist = d; c2 = p; }
  }

  for (let iter = 0; iter < maxIter; iter++) {
    const sum1 = [0, 0, 0]; let cnt1 = 0;
    const sum2 = [0, 0, 0]; let cnt2 = 0;
    for (const p of pixels) {
      if (colorDist(p, c1) <= colorDist(p, c2)) {
        sum1[0] += p[0]; sum1[1] += p[1]; sum1[2] += p[2]; cnt1++;
      } else {
        sum2[0] += p[0]; sum2[1] += p[1]; sum2[2] += p[2]; cnt2++;
      }
    }
    const newC1 = cnt1 > 0 ? [sum1[0]/cnt1, sum1[1]/cnt1, sum1[2]/cnt1] : c1;
    const newC2 = cnt2 > 0 ? [sum2[0]/cnt2, sum2[1]/cnt2, sum2[2]/cnt2] : c2;
    if (colorDist(newC1, c1) < 1 && colorDist(newC2, c2) < 1) break;
    c1 = newC1; c2 = newC2;
    if (cnt2 > cnt1) { [c1, c2] = [c2, c1]; } // keep c1 as the larger cluster
  }

  return [toHex(c1), toHex(c2)];
}

function colorDist(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/**
 * Given a favicon image buffer, extract two dominant colors.
 * Returns { bg, fg } — bg = most-common color, fg = other.
 */
async function extractColors(imageBuffer) {
  const { data } = await sharp(imageBuffer)
    .resize(32, 32, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip mostly-transparent pixels
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }

  if (pixels.length < 4) return { bg: '#000000', fg: '#ffffff' };

  const [bg, fg] = kMeans2(pixels);
  return { bg, fg };
}

// ---------------------------------------------------------------------------
// Generic: extract colors from any URL
// ---------------------------------------------------------------------------

/**
 * Fetch the favicon at `url`, extract bg+fg colors.
 * Returns { bg, fg } or null on failure.
 */
async function extractColorsFromUrl(url, label) {
  try {
    const faviconUrl = await resolveFaviconUrl(url);
    if (!faviconUrl) {
      console.log(`  ⚠️  ${label} — could not find favicon at ${url}`);
      return null;
    }
    console.log(`  🌐 ${label} — fetching ${faviconUrl}`);
    const imageBuffer = await fetchBuffer(faviconUrl);
    const colors = await extractColors(imageBuffer);
    console.log(`  ✅ ${label} — bg=${colors.bg} fg=${colors.fg}`);
    return colors;
  } catch (err) {
    console.log(`  ⚠️  ${label} — favicon extraction failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL priority: choose the best URL to represent an entity
// ---------------------------------------------------------------------------

/**
 * Pick the best URL to extract a favicon from for a bar or event.
 * Priority: website > instagram > facebook > other social/data links.
 * For instagram handles (not full URLs), construct the full URL.
 */
function chooseBestUrl(entity) {
  if (entity.website) return entity.website;
  if (entity.linktree) return entity.linktree;
  if (entity.instagram) {
    const ig = String(entity.instagram);
    return ig.startsWith('http') ? ig : `https://www.instagram.com/${ig.replace(/^@/, '')}`;
  }
  if (entity.facebook) return entity.facebook;
  // Don't use gmaps/googlemaps/wikipedia/gayCities — those favicons aren't entity-specific
  return null;
}

// ---------------------------------------------------------------------------
// Bar processing
// ---------------------------------------------------------------------------

async function processBars(cityKey) {
  const filePath = path.join(BARS_DIR, `${cityKey}.json`);
  if (!fs.existsSync(filePath)) return;

  let bars;
  try {
    bars = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn(`⚠️  Could not parse bars/${cityKey}.json: ${err.message}`);
    return;
  }

  console.log(`\n🍺 Bars — ${cityKey} (${bars.length})`);
  let changed = false;

  for (const bar of bars) {
    if (!FORCE && bar.faviconBg && bar.faviconFg) {
      console.log(`  ⏭️  ${bar.name} — already has colors`);
      continue;
    }
    const url = chooseBestUrl(bar);
    if (!url) {
      console.log(`  ⏭️  ${bar.name} — no usable URL`);
      continue;
    }
    const colors = await extractColorsFromUrl(url, bar.name);
    if (colors) {
      bar.faviconBg = colors.bg;
      bar.faviconFg = colors.fg;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(bars, null, 2));
    console.log(`  💾 Saved bars/${cityKey}.json`);
  }
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

// Load CalendarCore for ICS parsing
let CalendarCore;
try {
  CalendarCore = require(path.join(ROOT, 'js', 'calendar-core.js'));
  // Minimal logger shim so CalendarCore doesn't throw
  if (typeof global.logger === 'undefined') {
    global.logger = { debug() {}, info() {}, warn() {}, error() {}, componentInit() {}, componentLoad() {}, componentError() {}, time() {}, timeEnd() {}, apiCall() {}, performance() {} };
  }
} catch (err) {
  console.error('Could not load CalendarCore:', err.message);
  process.exit(1);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function processEvents(cityKey) {
  const icsPath = path.join(ROOT, 'data', 'calendars', `${cityKey}.ics`);
  if (!fs.existsSync(icsPath)) return;

  const icalText = fs.readFileSync(icsPath, 'utf8');
  let events;
  try {
    const calendar = new CalendarCore();
    events = calendar.parseICalData(icalText) || [];
  } catch (err) {
    console.warn(`⚠️  Could not parse ${cityKey}.ics: ${err.message}`);
    return;
  }

  // Load existing event colors for this city
  ensureDir(EVENT_COLORS_DIR);
  const colorsPath = path.join(EVENT_COLORS_DIR, `${cityKey}.json`);
  let existing = [];
  if (fs.existsSync(colorsPath)) {
    try { existing = JSON.parse(fs.readFileSync(colorsPath, 'utf8')); } catch { existing = []; }
  }
  const existingBySlug = new Map(existing.map(e => [e.slug, e]));

  console.log(`\n📅 Events — ${cityKey} (${events.length})`);
  let changed = false;

  // Deduplicate by slug
  const seen = new Set();
  for (const event of events) {
    if (!event.slug) continue;
    if (seen.has(event.slug)) continue;
    seen.add(event.slug);

    const prev = existingBySlug.get(event.slug);
    if (!FORCE && prev && prev.faviconBg && prev.faviconFg) {
      console.log(`  ⏭️  ${event.name} — already has colors`);
      continue;
    }

    const url = chooseBestUrl(event);
    if (!url) {
      console.log(`  ⏭️  ${event.name} — no usable URL`);
      continue;
    }

    const colors = await extractColorsFromUrl(url, event.name);
    if (colors) {
      existingBySlug.set(event.slug, { slug: event.slug, url, faviconBg: colors.bg, faviconFg: colors.fg });
      changed = true;
    }
  }

  if (changed) {
    const output = Array.from(existingBySlug.values())
      .sort((a, b) => a.slug.localeCompare(b.slug));
    fs.writeFileSync(colorsPath, JSON.stringify(output, null, 2));
    console.log(`  💾 Saved event-colors/${cityKey}.json`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Gather list of cities to process
  const cities = new Set();

  if (DO_BARS && fs.existsSync(BARS_DIR)) {
    fs.readdirSync(BARS_DIR)
      .filter(f => f.endsWith('.json'))
      .forEach(f => cities.add(f.replace('.json', '')));
  }

  if (DO_EVENTS) {
    const calDir = path.join(ROOT, 'data', 'calendars');
    if (fs.existsSync(calDir)) {
      fs.readdirSync(calDir)
        .filter(f => f.endsWith('.ics'))
        .forEach(f => cities.add(f.replace('.ics', '')));
    }
  }

  if (cityFilter) {
    if (!cities.has(cityFilter)) {
      console.error(`City "${cityFilter}" not found.`);
      process.exit(1);
    }
    cities.clear();
    cities.add(cityFilter);
  }

  if (cities.size === 0) {
    console.log('Nothing to process.');
    return;
  }

  for (const city of [...cities].sort()) {
    if (DO_BARS)   await processBars(city);
    if (DO_EVENTS) await processEvents(city);
  }

  console.log('\n✅ Favicon color extraction complete.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});


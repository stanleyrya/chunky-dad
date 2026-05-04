#!/usr/bin/env node

/**
 * Extract two dominant colors (background + foreground/symbol) from bar favicons.
 *
 * For well-known social platforms the brand colors are hardcoded.
 * For bar website URLs the favicon is fetched, decoded with sharp, and the two
 * most dominant opaque colors are found via k-means (k=2) on the raw RGBA pixels.
 *
 * Results are written back into data/bars/<city>.json as `faviconBg` and `faviconFg`.
 *
 * Usage:
 *   node tools/extract-favicon-colors.js [--force] [--city <city>] [--bar "<bar name>"]
 *
 * Options:
 *   --force           Re-extract even if faviconBg/faviconFg already present
 *   --city <city>     Only process bars in the given city file
 *   --bar  <name>     Only process the bar with the given name (case-insensitive)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const BARS_DIR = path.join(ROOT, 'data', 'bars');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const cityFilter = (() => {
  const idx = args.indexOf('--city');
  return idx !== -1 ? args[idx + 1] : null;
})();
const barFilter = (() => {
  const idx = args.indexOf('--bar');
  return idx !== -1 ? (args[idx + 1] || '').toLowerCase() : null;
})();

// ---------------------------------------------------------------------------
// Hardcoded brand colors for well-known platforms.
// bg = dominant background color, fg = symbol / foreground color.
// ---------------------------------------------------------------------------
const PLATFORM_COLORS = {
  instagram: { bg: '#E4405F', fg: '#ffffff' },
  facebook:  { bg: '#1877F2', fg: '#ffffff' },
  linktree:  { bg: '#43E55C', fg: '#1A1A1A' },
  twitter:   { bg: '#000000', fg: '#ffffff' },
  x:         { bg: '#000000', fg: '#ffffff' },
  tiktok:    { bg: '#010101', fg: '#ffffff' },
  youtube:   { bg: '#FF0000', fg: '#ffffff' },
  gaycities: { bg: '#CC0066', fg: '#ffffff' },
  wikipedia: { bg: '#ffffff', fg: '#000000' },
  googlemaps:{ bg: '#4285F4', fg: '#ffffff' },
};

// Map URL hostname to platform key using exact hostname matching to prevent
// substring-based spoofing (e.g. evilinstagram.com or instagram.com.evil.com).
const PLATFORM_HOSTNAMES = {
  'instagram.com':     'instagram',
  'www.instagram.com': 'instagram',
  'facebook.com':      'facebook',
  'www.facebook.com':  'facebook',
  'linktr.ee':         'linktree',
  'linktree.com':      'linktree',
  'www.linktree.com':  'linktree',
  'twitter.com':       'twitter',
  'www.twitter.com':   'twitter',
  'x.com':             'twitter',
  'www.x.com':         'twitter',
  'tiktok.com':        'tiktok',
  'www.tiktok.com':    'tiktok',
  'youtube.com':       'youtube',
  'www.youtube.com':   'youtube',
  'm.youtube.com':     'youtube',
  'gaycities.com':     'gaycities',
  'newyork.gaycities.com': 'gaycities',
  'losangeles.gaycities.com': 'gaycities',
  'seattle.gaycities.com': 'gaycities',
  'london.gaycities.com': 'gaycities',
  'en.wikipedia.org':  'wikipedia',
  'www.wikipedia.org': 'wikipedia',
  'maps.google.com':   'googlemaps',
  'www.google.com':    'googlemaps',
  'goo.gl':            'googlemaps',
};

function detectPlatform(url) {
  if (!url) return null;
  try {
    const { hostname, pathname } = new URL(url);
    const host = hostname.toLowerCase();
    // Exact hostname match
    if (PLATFORM_HOSTNAMES[host]) return PLATFORM_HOSTNAMES[host];
    // google.com is a googlemaps link only when the path starts with /maps
    if (host === 'www.google.com' && pathname.startsWith('/maps')) return 'googlemaps';
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP fetch helpers
// ---------------------------------------------------------------------------

/** Fetch a URL, following up to maxRedirects redirects. Returns Buffer. */
function fetchBuffer(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
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
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        const redirectUrl = new URL(res.headers.location, url).toString();
        resolve(fetchBuffer(redirectUrl, maxRedirects - 1));
        res.resume();
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
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
  // Look for <link rel="icon"> or <link rel="shortcut icon">
  const iconPattern = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  const candidates = [];
  let m;
  while ((m = iconPattern.exec(html)) !== null) {
    candidates.push(m[1]);
  }
  // Prefer PNG over ICO
  const png = candidates.find(c => c.toLowerCase().endsWith('.png'));
  const ico = candidates.find(c => c.toLowerCase().endsWith('.ico'));
  const chosen = png || ico || candidates[0];
  if (!chosen) return null;
  try {
    return new URL(chosen, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Find the favicon URL for a given website URL. */
async function resolveFaviconUrl(websiteUrl) {
  const origin = new URL(websiteUrl).origin;
  const icoUrl = `${origin}/favicon.ico`;

  // First try /favicon.ico
  try {
    const buf = await fetchBuffer(icoUrl);
    if (buf.length > 0) return icoUrl;
  } catch {
    // fall through
  }

  // Try parsing the HTML
  try {
    const html = await fetchText(websiteUrl);
    const found = parseFaviconFromHtml(html, websiteUrl);
    if (found) return found;
  } catch {
    // fall through
  }

  return null;
}

// ---------------------------------------------------------------------------
// Color extraction using sharp
// ---------------------------------------------------------------------------

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('sharp is required. Run: npm install sharp');
  process.exit(1);
}

/**
 * Simple k-means (k=2) on RGB pixels.
 * Returns the two cluster centroids as hex strings, ordered by cluster size (largest first).
 */
function kMeans2(pixels, maxIter = 20) {
  if (pixels.length < 2) return ['#000000', '#ffffff'];

  // Initialize with the first pixel and the pixel farthest from it
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
    // Swap so c1 is always the larger cluster
    if (cnt2 > cnt1) { [c1, c2] = [c2, c1]; }
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
 * Returns { bg, fg } where bg is the most-common color and fg is the other.
 */
async function extractColors(imageBuffer) {
  // Resize to 32x32 RGBA for speed / consistency
  const { data, info } = await sharp(imageBuffer)
    .resize(32, 32, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue; // skip mostly-transparent pixels
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }

  if (pixels.length < 4) return { bg: '#000000', fg: '#ffffff' };

  const [bg, fg] = kMeans2(pixels);
  return { bg, fg };
}

// ---------------------------------------------------------------------------
// Per-bar processing
// ---------------------------------------------------------------------------

/**
 * Determine the best URL from which to fetch a favicon for a bar.
 * Priority: website > linktree > other links.
 */
function choosePrimaryUrl(bar) {
  // Prefer the bar's own website for actual extraction
  if (bar.website) return { url: bar.website, type: 'website' };
  if (bar.linktree) return { url: bar.linktree, type: 'linktree' };
  // Social links we detect by URL pattern
  if (bar.instagram) {
    const url = bar.instagram.startsWith('http') ? bar.instagram : `https://instagram.com/${bar.instagram}`;
    return { url, type: 'instagram' };
  }
  if (bar.facebook) return { url: bar.facebook, type: 'facebook' };
  if (bar.wikipedia) return { url: bar.wikipedia, type: 'wikipedia' };
  if (bar.gayCities) return { url: bar.gayCities, type: 'gaycities' };
  if (bar.googleMaps) return { url: bar.googleMaps, type: 'googlemaps' };
  return null;
}

async function processBar(bar) {
  const primary = choosePrimaryUrl(bar);
  if (!primary) {
    console.log(`  ⏭️  ${bar.name} — no URLs, skipping`);
    return {};
  }

  // Check if this URL is a known platform — use hardcoded colors
  const platform = detectPlatform(primary.url) || primary.type;
  if (PLATFORM_COLORS[platform]) {
    console.log(`  🎨 ${bar.name} — using hardcoded ${platform} colors`);
    return PLATFORM_COLORS[platform];
  }

  // Otherwise fetch the favicon and extract colors
  try {
    const faviconUrl = await resolveFaviconUrl(primary.url);
    if (!faviconUrl) {
      console.log(`  ⚠️  ${bar.name} — could not find favicon at ${primary.url}`);
      return {};
    }
    console.log(`  🌐 ${bar.name} — fetching favicon ${faviconUrl}`);
    const imageBuffer = await fetchBuffer(faviconUrl);
    const colors = await extractColors(imageBuffer);
    console.log(`  ✅ ${bar.name} — bg=${colors.bg} fg=${colors.fg}`);
    return colors;
  } catch (err) {
    console.log(`  ⚠️  ${bar.name} — favicon fetch failed: ${err.message}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(BARS_DIR)) {
    console.error(`Bars directory not found: ${BARS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(BARS_DIR)
    .filter(f => f.endsWith('.json'))
    .filter(f => !cityFilter || f === `${cityFilter}.json`);

  if (files.length === 0) {
    console.log('No bar files found to process.');
    return;
  }

  for (const file of files) {
    const filePath = path.join(BARS_DIR, file);
    let bars;
    try {
      bars = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.warn(`⚠️  Could not parse ${file}: ${err.message}`);
      continue;
    }

    const cityKey = file.replace('.json', '');
    console.log(`\n📁 Processing ${cityKey} (${bars.length} bars)…`);
    let changed = false;

    for (const bar of bars) {
      if (barFilter && bar.name.toLowerCase() !== barFilter) continue;
      if (!FORCE && bar.faviconBg && bar.faviconFg) {
        console.log(`  ⏭️  ${bar.name} — already has colors (use --force to re-extract)`);
        continue;
      }
      const colors = await processBar(bar);
      if (colors.bg) {
        bar.faviconBg = colors.bg;
        bar.faviconFg = colors.fg || '#ffffff';
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, JSON.stringify(bars, null, 2));
      console.log(`💾 Saved ${file}`);
    } else {
      console.log(`⏭️  No changes for ${file}`);
    }
  }

  console.log('\n✅ Favicon color extraction complete.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

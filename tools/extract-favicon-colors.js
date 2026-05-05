#!/usr/bin/env node

/**
 * Extract two dominant colors (background + foreground/symbol) from already-downloaded
 * favicon images in img/favicons/.
 *
 * Favicons are downloaded by tools/download-images.js.  This script reads those
 * local files — it makes no network requests.  The same favicon-lookup logic used
 * by download-images.js is reused here so the two tools stay in sync:
 *
 *   • Regular websites  → Google Favicon service filename, e.g. favicon-animal.nyc-64px.ico
 *   • Linktree pages    → profile-picture filename, e.g. favicon-linktr.ee-cubhouse-64px.png
 *   • Wikipedia pages   → infobox-logo filename, e.g. favicon-wikipedia-wiki-Eagle_NYC-64px.png
 *
 * Generic social platforms (instagram, facebook, twitter, tiktok, youtube, googlemaps)
 * are skipped — they have no entity-specific locally-stored favicon.
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

const ROOT             = path.resolve(__dirname, '..');
const FAVICONS_DIR     = path.join(ROOT, 'img', 'favicons');
const BARS_DIR         = path.join(ROOT, 'data', 'bars');
const EVENT_COLORS_DIR = path.join(ROOT, 'data', 'event-colors');

// Shared filename utilities (same as used by download-images.js)
const {
  convertWebsiteUrlToFaviconPath,
  isLinktreeUrl,
  isWikipediaUrl,
  generateLinktreeFaviconFilename,
  generateWikipediaFaviconFilename,
} = require(path.join(ROOT, 'js', 'filename-utils.js'));

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const FORCE       = args.includes('--force');
const ONLY_BARS   = args.includes('--bars');
const ONLY_EVENTS = args.includes('--events');
const DO_BARS     = !ONLY_EVENTS;
const DO_EVENTS   = !ONLY_BARS;
const cityFilter  = (() => {
  const idx = args.indexOf('--city');
  return idx !== -1 ? args[idx + 1] : null;
})();

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Hostnames that map to generic platform favicons — not entity-specific.
 * We skip these because their favicon doesn't tell us anything about the
 * bar or event itself.
 */
const GENERIC_HOSTNAMES = new Set([
  'instagram.com', 'www.instagram.com',
  'facebook.com',  'www.facebook.com',
  'twitter.com',   'www.twitter.com',
  'x.com',         'www.x.com',
  'tiktok.com',    'www.tiktok.com',
  'youtube.com',   'www.youtube.com', 'm.youtube.com',
  'maps.google.com', 'www.google.com', 'goo.gl',
]);

function isGenericPlatformUrl(url) {
  try {
    return GENERIC_HOSTNAMES.has(new URL(url).hostname.toLowerCase());
  } catch {
    return true; // treat unparseable URLs as generic/skip
  }
}

/**
 * Given a website URL, return the absolute path to the already-downloaded
 * local favicon file (or null if the file doesn't exist / URL is skipped).
 * Mirrors the filename logic in download-images.js so the two tools stay in sync.
 */
function localFaviconPath(websiteUrl) {
  if (!websiteUrl) return null;
  if (isGenericPlatformUrl(websiteUrl)) return null;

  let filename;
  if (isWikipediaUrl(websiteUrl)) {
    // Try both 64px and 256px — prefer 64px
    for (const size of ['64', '256']) {
      const f = path.join(FAVICONS_DIR, generateWikipediaFaviconFilename(websiteUrl, size));
      if (fs.existsSync(f)) return f;
    }
    return null;
  } else if (isLinktreeUrl(websiteUrl)) {
    // Try both 64px and 256px — prefer 64px
    for (const size of ['64', '256']) {
      const f = path.join(FAVICONS_DIR, generateLinktreeFaviconFilename(websiteUrl, size));
      if (fs.existsSync(f)) return f;
    }
    return null;
  } else {
    // convertWebsiteUrlToFaviconPath returns a relative path like 'img/favicons/favicon-…'
    const relative = convertWebsiteUrlToFaviconPath(websiteUrl);
    filename = path.basename(relative);
  }

  // Try both 64px (preferred) and 256px variants
  const sizes = ['64', '256'];
  for (const size of sizes) {
    // Swap the size suffix if the filename already has one
    const withSize = filename.replace(/(-\d+px)/, `-${size}px`);
    const full = path.join(FAVICONS_DIR, withSize);
    if (fs.existsSync(full)) return full;
  }

  // Exact filename match (no size substitution needed)
  const exact = path.join(FAVICONS_DIR, filename);
  if (fs.existsSync(exact)) return exact;

  return null;
}

/**
 * Pick the best URL to represent a bar or event for color extraction.
 * Priority: own website → linktree.
 * Social platforms (instagram/facebook/etc.) are skipped.
 */
function chooseBestUrl(entity) {
  // Own website (not a social platform)
  if (entity.website && !isGenericPlatformUrl(entity.website)) return entity.website;
  // Linktree (profile picture already downloaded)
  if (entity.linktree && !isGenericPlatformUrl(entity.linktree)) return entity.linktree;
  // Wikipedia (bar logo already downloaded)
  if (entity.wikipedia && isWikipediaUrl(entity.wikipedia)) return entity.wikipedia;
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
 * Returns [bg, fg] hex strings — bg = larger cluster, fg = smaller.
 */
function kMeans2(pixels, maxIter = 20) {
  if (pixels.length < 2) return ['#000000', '#ffffff'];

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
 * Extract bg + fg colors from a local image file.
 * Returns { bg, fg } or null on failure.
 */
async function extractColorsFromFile(filePath, label) {
  try {
    const { data } = await sharp(filePath)
      .resize(32, 32, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }

    if (pixels.length < 4) return null;

    const [bg, fg] = kMeans2(pixels);
    console.log(`  ✅ ${label} — bg=${bg} fg=${fg} (${path.basename(filePath)})`);
    return { bg, fg };
  } catch (err) {
    console.log(`  ⚠️  ${label} — color extraction failed: ${err.message}`);
    return null;
  }
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
    const localPath = localFaviconPath(url);
    if (!localPath) {
      console.log(`  ⏭️  ${bar.name} — local favicon not found for ${url} (run download-images first)`);
      continue;
    }
    const colors = await extractColorsFromFile(localPath, bar.name);
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

// Load CalendarCore for ICS parsing (EventSchema must be loaded first as a global)
let CalendarCore;
try {
  if (typeof global.logger === 'undefined') {
    global.logger = { debug() {}, info() {}, warn() {}, error() {}, componentInit() {}, componentLoad() {}, componentError() {}, time() {}, timeEnd() {}, apiCall() {}, performance() {} };
  }
  // EventSchema must be available globally before CalendarCore is loaded.
  // Requiring event-schema.js sets globalThis.EventSchema as a side effect
  // (see the if (typeof module !== 'undefined') block at the bottom of js/event-schema.js).
  require(path.join(ROOT, 'js', 'event-schema.js'));
  CalendarCore = require(path.join(ROOT, 'js', 'calendar-core.js'));
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

  ensureDir(EVENT_COLORS_DIR);
  const colorsPath = path.join(EVENT_COLORS_DIR, `${cityKey}.json`);
  let existing = [];
  if (fs.existsSync(colorsPath)) {
    try { existing = JSON.parse(fs.readFileSync(colorsPath, 'utf8')); } catch { existing = []; }
  }
  const existingBySlug = new Map(existing.map(e => [e.slug, e]));

  console.log(`\n📅 Events — ${cityKey} (${events.length})`);
  let changed = false;

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

    const localPath = localFaviconPath(url);
    if (!localPath) {
      console.log(`  ⏭️  ${event.name} — local favicon not found for ${url} (run download-images first)`);
      continue;
    }

    const colors = await extractColorsFromFile(localPath, event.name);
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


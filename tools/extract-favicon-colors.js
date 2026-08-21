#!/usr/bin/env node

/**
 * Extract brand colours from already-downloaded LOCAL artwork: favicons in
 * img/favicons/ and event flyers in img/events/.  Makes no network requests.
 *
 * Two things come out of every image:
 *
 *   1. `faviconBg` / `faviconFg` — the ORIGINAL two-colour pair, produced by the
 *      unchanged k=2 RGB k-means over a 32×32 resize of the FAVICON with alpha
 *      < 128 dropped, so existing consumers (tools/generate-og-images.js, the
 *      aurora card's legacy path) keep working and the committed data doesn't
 *      churn.  A handful of stored pairs do shift by ±1 per channel on
 *      re-extraction — that predates this change (the same drift comes out of
 *      the previous version of this file; the committed values were produced by
 *      a different sharp/libvips build), it is not a change in behaviour.
 *
 *   2. `palette` / `accent` / `paletteSource` — the richer replacement.  A
 *      weighted k-means in OKLab over a colour histogram of the best available
 *      artwork, near-duplicate clusters merged, ordered by population:
 *
 *        "paletteSource": "flyer",
 *        "palette": "#0d0c14:46:3 #d8342a:19:22 #e8c7a1:11:7",
 *        "accent":  "#d8342a"
 *
 *      Each palette token is `hex:share:chroma` — `share` = percent of the image
 *      the colour covers, `chroma` = OKLab chroma ×100 (0 = grey, ~32 = the most
 *      saturated colour sRGB can hold).  One packed line per entity rather than
 *      an array of objects because these files are committed and reviewed: the
 *      object form cost ~6,000 lines of JSON across data/ for 800 numbers, and
 *      it re-expanded every time another writer (tools/sync-bars.js) round-tripped
 *      a bars file.  Packed, a palette change is one readable line in a diff.
 *
 *      `accent` is the most usable saturated colour and is OMITTED for genuinely
 *      colourless artwork — its absence is how a consumer knows to fall back,
 *      replacing the "is this pair grey?" guesswork consumers used to do.
 *
 * Why two colours were not enough: near-white brands (Eagle NYC #f0f0f0, CHUNK
 * #f6f4f5) yielded grey pairs, and single-colour marks whose plate was dropped
 * with the alpha (Animal #e51a1a/#f31c1c, Bearracuda #ff1901/#ff5000) yielded two
 * nearly identical colours — a flat "gradient".  A five-entry palette carries the
 * plate, the ink AND the brand colour, so the consumer picks stops instead of
 * guessing.
 *
 * Artwork preference:
 *   • Events — the FLYER (event.image, matched to img/events/ through the
 *     .meta sidecars download-images.js writes) whenever one is on disk; it is
 *     the event's own art and far richer than a 32px favicon.  The favicon is
 *     the fallback and stays the brand-identity signal: if the flyer turns out
 *     colourless but the favicon has an accent, the favicon wins.
 *   • Bars — the favicon (bars have no flyer).
 *
 * Favicon lookup mirrors download-images.js so the two tools stay in sync:
 *   • Regular websites  → Google Favicon service filename, e.g. favicon-animal.nyc-64px.ico
 *   • Linktree pages    → profile-picture filename, e.g. favicon-linktr.ee-cubhouse-64px.png
 *   • Wikipedia pages   → infobox-logo filename, e.g. favicon-wikipedia-wiki-Eagle_NYC-64px.png
 *
 * Generic social platforms (instagram, facebook, twitter, tiktok, youtube, googlemaps)
 * are skipped — they have no entity-specific locally-stored favicon.
 *
 * Bars:   results written to data/bars/<city>.json.
 * Events: results written to data/event-colors/<city>.json as
 *         [{ slug, url, faviconBg, faviconFg, paletteSource, palette, accent }, …].
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
  isPlatformFaviconUrl,
  cleanImageUrl,
} = require(path.join(ROOT, 'js', 'filename-utils.js'));

const EVENTS_DIR = path.join(ROOT, 'img', 'events');

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
  // The shared test in js/filename-utils.js is authoritative (it also covers
  // ticketing platforms, whose favicons were seeding event colours); the local
  // set below stays as a belt-and-braces fallback for older checkouts.
  if (typeof isPlatformFaviconUrl === 'function' && isPlatformFaviconUrl(url)) return true;
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

// ---------------------------------------------------------------------------
// Event flyer lookup (img/events/)
// ---------------------------------------------------------------------------

/**
 * download-images.js unwraps Eventbrite's img.evbuc.com proxy before hashing the
 * filename, so the same unwrapping has to happen here or those flyers are never
 * found.  Same logic, minus the logging (see adjustEventbriteImageUrl there).
 */
function unwrapEventbriteImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return imageUrl;
  if (!imageUrl.includes('img.evbuc.com')) return imageUrl;
  try {
    const inner = decodeURIComponent(new URL(imageUrl).pathname.substring(1));
    if (!inner.includes('cdn.evbuc.com')) return imageUrl;
    const innerUrl = new URL(inner);
    return `${innerUrl.protocol}//${innerUrl.host}${innerUrl.pathname}`;
  } catch {
    return imageUrl;
  }
}

/**
 * Index of downloaded event flyers, keyed by the image URL they came from.
 *
 * The filename itself can NOT be recomputed reliably: generateEventFilename()
 * puts the event's start date in it, and a date rendered in one timezone (the
 * machine that ran download-images.js) doesn't always match the date this
 * process computes — several Portland flyers are one day off.  The `.meta`
 * sidecar records the exact `originalUrl` / `adjustedUrl`, so index by those
 * instead and the match is exact regardless of naming drift.
 *
 * Built once, lazily; ~300 tiny JSON reads.
 */
let flyerIndex = null;

function buildFlyerIndex() {
  const index = new Map();
  if (!fs.existsSync(EVENTS_DIR)) return index;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.meta')) continue;
      const imagePath = full.slice(0, -'.meta'.length);
      if (!fs.existsSync(imagePath)) continue; // failure-only metadata
      let meta;
      try { meta = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
      for (const url of [meta.originalUrl, meta.adjustedUrl]) {
        if (url && !index.has(url)) index.set(url, imagePath);
      }
    }
  };
  walk(EVENTS_DIR);
  return index;
}

/**
 * Absolute path to an event's already-downloaded flyer, or null.
 * Tries the URL as it appears in the calendar plus the two normalisations
 * download-images.js applies before saving (cleanImageUrl, Eventbrite unwrap).
 */
function localFlyerPath(event) {
  if (!event || !event.image) return null;
  if (!flyerIndex) flyerIndex = buildFlyerIndex();

  const raw = event.image;
  const cleaned = cleanImageUrl(raw);
  const candidates = [raw, cleaned, unwrapEventbriteImageUrl(raw), unwrapEventbriteImageUrl(cleaned)];
  for (const candidate of candidates) {
    const hit = candidate && flyerIndex.get(candidate);
    if (hit) return hit;
  }
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
 * LEGACY two-colour pair, unchanged on purpose.
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
    return { bg, fg };
  } catch (err) {
    console.log(`  ⚠️  ${label} — color extraction failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Perceptual palette extraction (OKLab)
// ---------------------------------------------------------------------------
//
// RGB euclidean distance is a poor stand-in for "looks different": #000080 and
// #008000 are equidistant from black in RGB but nothing like equally far apart
// to an eye.  OKLab is cheap (a matrix, a cube root, a matrix) and near-uniform,
// so cluster distances, the near-duplicate merge threshold and the grey test all
// become single fixed numbers that hold across every brand.
//
// No dependency for this — sharp decodes, the ~40 lines below do the rest.

// Longest edge the analysed image is sampled down to.  `nearest` is deliberate:
// a palette should contain colours that ARE in the artwork, and a smoothing
// kernel invents blends along every high-contrast edge (a black logo on white
// sprouts a family of greys that can outvote the brand colour).
const SAMPLE_DIM = 128;

// Low bits dropped per channel when bucketing (3 → 32 levels per channel).
// Collapses JPEG noise into one weighted cluster candidate, so k-means runs over
// a few thousand points instead of tens of thousands of pixels.
const QUANT_BITS = 3;

const CLUSTER_COUNT = 8;      // before merging; small vivid marks need the headroom
const MERGE_DISTANCE = 0.075; // OKLab ΔE below which two clusters are "the same colour"
const MAX_PALETTE = 5;        // entries written out
const MIN_PALETTE_SHARE = 0.004; // 0.4% of the image — below this it's noise

// Accent gates: what may represent a brand.
const ACCENT_MIN_CHROMA = 0.045; // below this it's a grey/near-grey
const ACCENT_MAX_L = 0.90;       // near-white plate — reported, never the accent
const ACCENT_MIN_L = 0.10;       // near-black ink — same

function srgbChannelToLinear(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB (0–255) → OKLab. https://bottosson.github.io/posts/oklab/ */
function rgbToOklab(r, g, b) {
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);

  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);

  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

function oklabChroma(lab) {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

function oklabDistance(a, b) {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/**
 * Sample an image into a weighted colour histogram.
 *
 * Alpha is COMPOSITED OVER WHITE rather than thresholded away.  The favicon
 * plate is a fixed white now (--favicon-plate-* in styles.css), so white *is*
 * what sits behind a transparent logo — dropping those pixels (what the legacy
 * pair does) throws away the plate and with it any sense of contrast: Animal's
 * transparent-background red "A" reduced to red-on-red.
 *
 * Returns [{ r, g, b, lab, weight }] ordered by weight, or null.
 */
async function sampleImageColors(filePath) {
  const { data, info } = await sharp(filePath)
    .resize(SAMPLE_DIM, SAMPLE_DIM, { fit: 'inside', kernel: 'nearest', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) return null;

  const buckets = new Map();
  let pixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    // Composite over the white plate.
    const r = data[i] * alpha + 255 * (1 - alpha);
    const g = data[i + 1] * alpha + 255 * (1 - alpha);
    const b = data[i + 2] * alpha + 255 * (1 - alpha);

    const key = ((r >> QUANT_BITS) << 10) | ((g >> QUANT_BITS) << 5) | (b >> QUANT_BITS);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { r: 0, g: 0, b: 0, n: 0 };
      buckets.set(key, bucket);
    }
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++;
    pixels++;
  }

  if (pixels === 0) return null;

  // Deterministic order (weight desc, then colour) — the output is committed
  // JSON, so nothing here may depend on Map iteration luck or a RNG.
  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const r = bucket.r / bucket.n;
      const g = bucket.g / bucket.n;
      const b = bucket.b / bucket.n;
      return { key, r, g, b, lab: rgbToOklab(r, g, b), weight: bucket.n / pixels };
    })
    .sort((a, b) => (b.weight - a.weight) || (a.key - b.key));
}

/**
 * Weighted k-means in OKLab with a deterministic farthest-point seeding
 * (population × distance², no randomness), then a merge pass that collapses
 * clusters closer than MERGE_DISTANCE.
 *
 * Each returned cluster reports its MEDOID — the histogram bin nearest the
 * centroid — not the centroid itself, so every palette hex is a colour that
 * actually occurs in the artwork instead of an invented blend of two.
 */
function clusterColors(bins, k) {
  const count = Math.min(k, bins.length);
  const centroids = [bins[0].lab];

  while (centroids.length < count) {
    let best = null;
    let bestScore = -1;
    for (const bin of bins) {
      let nearest = Infinity;
      for (const centroid of centroids) {
        const d = oklabDistance(bin.lab, centroid);
        if (d < nearest) nearest = d;
      }
      const score = bin.weight * nearest * nearest;
      if (score > bestScore) { bestScore = score; best = bin; }
    }
    if (!best || bestScore <= 0) break;
    centroids.push(best.lab);
  }

  let assignment = new Array(bins.length).fill(0);
  for (let iter = 0; iter < 40; iter++) {
    let moved = false;
    for (let i = 0; i < bins.length; i++) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = oklabDistance(bins[i].lab, centroids[c]);
        if (d < bestDistance) { bestDistance = d; bestIndex = c; }
      }
      if (assignment[i] !== bestIndex) { assignment[i] = bestIndex; moved = true; }
    }

    const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, w: 0 }));
    for (let i = 0; i < bins.length; i++) {
      const sum = sums[assignment[i]];
      const { lab, weight } = bins[i];
      sum.L += lab.L * weight; sum.a += lab.a * weight; sum.b += lab.b * weight; sum.w += weight;
    }
    centroids.forEach((centroid, index) => {
      const sum = sums[index];
      if (sum.w > 0) centroids[index] = { L: sum.L / sum.w, a: sum.a / sum.w, b: sum.b / sum.w };
    });

    if (!moved) break;
  }

  // Collect members, drop empties.
  let clusters = centroids.map(centroid => ({ centroid, weight: 0, members: [] }));
  for (let i = 0; i < bins.length; i++) {
    const cluster = clusters[assignment[i]];
    cluster.members.push(bins[i]);
    cluster.weight += bins[i].weight;
  }
  clusters = clusters.filter(cluster => cluster.members.length > 0);

  // Merge near-duplicates (repeatedly join the closest pair under threshold).
  for (;;) {
    let pair = null;
    let pairDistance = MERGE_DISTANCE;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = oklabDistance(clusters[i].centroid, clusters[j].centroid);
        if (d < pairDistance) { pairDistance = d; pair = [i, j]; }
      }
    }
    if (!pair) break;
    const [i, j] = pair;
    const a = clusters[i];
    const b = clusters[j];
    const weight = a.weight + b.weight;
    clusters[i] = {
      centroid: weight > 0 ? {
        L: (a.centroid.L * a.weight + b.centroid.L * b.weight) / weight,
        a: (a.centroid.a * a.weight + b.centroid.a * b.weight) / weight,
        b: (a.centroid.b * a.weight + b.centroid.b * b.weight) / weight,
      } : a.centroid,
      weight,
      members: a.members.concat(b.members),
    };
    clusters.splice(j, 1);
  }

  return clusters.map(cluster => {
    let medoid = cluster.members[0];
    let bestDistance = Infinity;
    for (const member of cluster.members) {
      const d = oklabDistance(member.lab, cluster.centroid);
      if (d < bestDistance - 1e-9 || (Math.abs(d - bestDistance) <= 1e-9 && member.weight > medoid.weight)) {
        bestDistance = Math.min(bestDistance, d);
        medoid = member;
      }
    }
    return { rgb: [medoid.r, medoid.g, medoid.b], lab: medoid.lab, weight: cluster.weight };
  });
}

/**
 * How well a colour would work as THE brand colour: chroma, damped by how much
 * of the image it covers.  The damping is a fractional power rather than the
 * raw share on purpose — a logo mark is often 1% of a favicon (Bear Happy
 * Hour's orange bars) and still the only brand colour in the file, so it has to
 * be able to out-score a large muted wash without a 40% skin tone losing to a
 * stray 0.5% speck.
 */
function accentScore(chroma, weight) {
  return chroma * Math.pow(Math.max(weight, 1e-6), 0.35);
}

/**
 * Build the palette record for one local image.
 * Returns { palette: 'hex:share:chroma …', accent?: string } or null.
 */
async function extractPaletteFromFile(filePath, label) {
  try {
    const bins = await sampleImageColors(filePath);
    if (!bins || bins.length === 0) return null;

    const clusters = clusterColors(bins, CLUSTER_COUNT)
      .map(cluster => ({
        hex: toHex(cluster.rgb),
        weight: cluster.weight,
        L: cluster.lab.L,
        chroma: oklabChroma(cluster.lab),
      }))
      .filter(cluster => cluster.weight >= MIN_PALETTE_SHARE)
      .sort((a, b) => b.weight - a.weight);

    if (clusters.length === 0) return null;

    // Keep the biggest few AND the most brand-usable few, so a tiny vivid mark
    // is never truncated away by three shades of plate.
    const kept = new Set(clusters.slice(0, 3));
    [...clusters]
      .filter(cluster => cluster.chroma >= ACCENT_MIN_CHROMA)
      .sort((a, b) => accentScore(b.chroma, b.weight) - accentScore(a.chroma, a.weight))
      .slice(0, MAX_PALETTE)
      .forEach(cluster => { if (kept.size < MAX_PALETTE) kept.add(cluster); });

    const accentCandidates = clusters.filter(cluster =>
      cluster.chroma >= ACCENT_MIN_CHROMA && cluster.L <= ACCENT_MAX_L && cluster.L >= ACCENT_MIN_L);
    accentCandidates.sort((a, b) => accentScore(b.chroma, b.weight) - accentScore(a.chroma, a.weight));
    const accent = accentCandidates.length > 0 ? accentCandidates[0] : null;

    // The accent must be in the palette or a consumer can't see how much of the
    // artwork it covers.
    if (accent && !kept.has(accent)) {
      if (kept.size >= MAX_PALETTE) {
        kept.delete([...kept].sort((a, b) => a.weight - b.weight)[0]);
      }
      kept.add(accent);
    }

    const palette = clusters
      .filter(cluster => kept.has(cluster))
      .slice(0, MAX_PALETTE)
      .map(cluster => `${cluster.hex}:${Math.max(1, Math.round(cluster.weight * 100))}:${Math.round(cluster.chroma * 100)}`)
      .join(' ');

    return accent ? { palette, accent: accent.hex } : { palette };
  } catch (err) {
    console.log(`  ⚠️  ${label} — palette extraction failed: ${err.message}`);
    return null;
  }
}


/**
 * The favicon's BACKGROUND colour, sampled from its outer edge.
 *
 * Not the most common colour overall: Bearracuda's mark fills ~72% of its
 * icon on a fully transparent background, so "highest coverage" called its
 * plate orange and the orange "B" then vanished into an orange tile. The
 * background is whatever sits at the EDGES, and a transparent edge composites
 * over white — which is exactly the white plate a transparent logo wants.
 *
 * Returns a hex string, or null when the file can't be read.
 */
async function extractPlateFromFile(filePath, label) {
  try {
    const size = 32;
    const { data, info } = await sharp(filePath)
      .resize(size, size, { fit: 'fill', kernel: 'nearest' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const counts = new Map();
    const consider = (x, y) => {
      const o = (y * info.width + x) * 4;
      const alpha = data[o + 3] / 255;
      // Composite over white: a transparent edge IS a white plate.
      const r = Math.round(data[o] * alpha + 255 * (1 - alpha));
      const g = Math.round(data[o + 1] * alpha + 255 * (1 - alpha));
      const b = Math.round(data[o + 2] * alpha + 255 * (1 - alpha));
      // Quantise so antialiasing along the edge doesn't split the vote.
      const key = `${r >> 3}:${g >> 3}:${b >> 3}`;
      const prev = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      counts.set(key, { n: prev.n + 1, r: prev.r + r, g: prev.g + g, b: prev.b + b });
    };

    const ring = 2; // outer band, in resized pixels
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const onEdge = x < ring || y < ring || x >= info.width - ring || y >= info.height - ring;
        if (onEdge) consider(x, y);
      }
    }

    let best = null;
    for (const bucket of counts.values()) {
      if (!best || bucket.n > best.n) best = bucket;
    }
    if (!best) return null;
    return toHex([best.r / best.n, best.g / best.n, best.b / best.n]);
  } catch (err) {
    console.log(`  ⚠️  ${label} — plate extraction failed: ${err.message}`);
    return null;
  }
}

/**
 * Everything colour-related for one entity, from the best artwork available.
 *
 * The legacy pair always comes from the FAVICON (that's what it has always
 * meant).  The palette prefers the flyer, because a poster carries the event's
 * real colour story, and falls back to the favicon when there is no flyer — or
 * when the flyer turns out to be colourless artwork and the favicon isn't,
 * since the brand mark is the better identity signal in that case.
 *
 * Returns { bg, fg, palette, accent, paletteSource } with every field optional.
 */
async function extractColorRecord({ faviconPath, flyerPath, label }) {
  const legacy = faviconPath ? await extractColorsFromFile(faviconPath, label) : null;

  const flyer = flyerPath ? await extractPaletteFromFile(flyerPath, label) : null;
  // The favicon palette is only needed when the flyer didn't give us a colour to
  // build on — no point decoding a second image otherwise.
  // Always read the favicon's palette when there is one: even when the flyer
  // supplies the card colours, the TILE still needs the favicon's own plate
  // colour (see faviconPlate below).
  const favicon = faviconPath ? await extractPaletteFromFile(faviconPath, label) : null;

  let chosen = null;
  let source = null;
  if (flyer && (flyer.accent || !favicon || !favicon.accent)) {
    chosen = flyer; source = 'flyer';
  } else if (favicon) {
    chosen = favicon; source = 'favicon';
  } else if (flyer) {
    chosen = flyer; source = 'flyer';
  }

  if (!legacy && !chosen) return null;

  // The favicon's own PLATE colour: the highest-coverage entry of the FAVICON's
  // palette, kept separately because `palette` may describe the flyer instead.
  // This is what the site paints behind and around a favicon tile, so a round
  // mark on white sits on white and a white mark on black sits on black — the
  // icon's own background, rather than a fixed white badge. It is a better
  // answer than faviconBg, which is a 2-means winner and can pick the MARK:
  // Animal's favicon reports faviconBg #e51a1a (its red "A") while its real
  // background is white at 61% coverage.
  const faviconPlate = faviconPath ? await extractPlateFromFile(faviconPath, label) : null;

  return {
    bg: legacy ? legacy.bg : null,
    fg: legacy ? legacy.fg : null,
    palette: chosen ? chosen.palette : null,
    accent: chosen && chosen.accent ? chosen.accent : null,
    paletteSource: source,
    faviconPlate,
  };
}

/** One-line summary of what came out, for the run log. */
function describeRecord(record) {
  const parts = [];
  if (record.bg) parts.push(`bg=${record.bg} fg=${record.fg}`);
  if (record.palette) {
    parts.push(`${record.paletteSource}=[${record.palette}]`);
    parts.push(record.accent ? `accent=${record.accent}` : 'accent=none');
  }
  return parts.join(' ');
}

/** Copy the colour fields onto a plain object, dropping the ones we don't have. */
function assignColorFields(target, record) {
  if (record.bg) target.faviconBg = record.bg;
  if (record.fg) target.faviconFg = record.fg;
  if (record.faviconPlate) target.faviconPlate = record.faviconPlate;
  else delete target.faviconPlate;
  if (record.palette) {
    target.paletteSource = record.paletteSource;
    target.palette = record.palette;
    if (record.accent) target.accent = record.accent;
    else delete target.accent;
  }
  return target;
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
    // "Already has colors" now means the palette too, or nothing would ever gain
    // one without --force.  The skip/--force behaviour itself is unchanged.
    if (!FORCE && bar.faviconBg && bar.faviconFg && bar.palette) {
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
    // Bars have no flyer — the favicon is the only artwork on disk.
    const record = await extractColorRecord({ faviconPath: localPath, flyerPath: null, label: bar.name });
    if (record) {
      const before = JSON.stringify(bar);
      assignColorFields(bar, record);
      console.log(`  ✅ ${bar.name} — ${describeRecord(record)} (${path.basename(localPath)})`);
      // Deterministic re-extraction: an unchanged bar must not rewrite the file.
      if (JSON.stringify(bar) !== before) changed = true;
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

  // Curated festivals render as calendar events too (slug
  // festival-<key>-<year>, see dynamic-calendar-loader), but they never pass
  // through the ICS files this loop reads — so their cards fell back to the
  // default plate (Urban Bear NYC, Bears Sitges Week). Feed them through the
  // same extraction as pseudo-events.
  try {
    const festivalsPath = path.join(ROOT, 'data', 'festivals.json');
    if (fs.existsSync(festivalsPath)) {
      const festivalsRaw = JSON.parse(fs.readFileSync(festivalsPath, 'utf8'));
      const festivalList = Array.isArray(festivalsRaw) ? festivalsRaw : (festivalsRaw.festivals || []);
      for (const fest of festivalList) {
        if (!fest || fest.cityKey !== cityKey || !fest.website) continue;
        const startRaw = fest.nextDates && fest.nextDates.start;
        const festYear = startRaw ? new Date(startRaw).getFullYear() : NaN;
        if (Number.isNaN(festYear)) continue;
        events.push({ slug: `festival-${fest.key}-${festYear}`, name: fest.name, website: fest.website });
      }
    }
  } catch (err) {
    console.warn(`⚠️  Could not merge festivals for ${cityKey}: ${err.message}`);
  }

  console.log(`\n📅 Events — ${cityKey} (${events.length})`);
  let changed = false;

  const seen = new Set();
  for (const event of events) {
    if (!event.slug) continue;
    if (seen.has(event.slug)) continue;
    seen.add(event.slug);

    const prev = existingBySlug.get(event.slug);

    // The event's favicon field is the site's FIRST icon choice (it is the
    // override field), so it must be the extraction's first choice too —
    // Goldiloxx's linktree profile pic sat downloaded on disk while this
    // loop only ever consulted the website field.
    const eventFaviconUrl = typeof event.favicon === 'string' && event.favicon
        && !isGenericPlatformUrl(event.favicon) ? event.favicon : null;
    const websiteUrl = chooseBestUrl(event);
    const url = eventFaviconUrl || websiteUrl;
    const faviconPath = url ? localFaviconPath(url) : null;
    // The flyer is the event's own artwork, so an event with a flyer is worth
    // processing even when its website is a ticketing platform we refuse to take
    // a favicon from (those used to be skipped outright, colourless).
    const flyerPath = localFlyerPath(event);

    if (!faviconPath && !flyerPath) {
      if (!url) console.log(`  ⏭️  ${event.name} — no usable URL and no local flyer`);
      else console.log(`  ⏭️  ${event.name} — local favicon not found for ${url} and no local flyer (run download-images first)`);
      continue;
    }

    // Same skip rule as bars — "already has colors" now includes the palette —
    // except that the legacy pair is only expected when there is a favicon to
    // derive it from, or flyer-only events would be re-extracted every run.
    const complete = prev && prev.palette && ((prev.faviconBg && prev.faviconFg) || !faviconPath);
    if (!FORCE && complete) {
      console.log(`  ⏭️  ${event.name} — already has colors`);
      continue;
    }

    const record = await extractColorRecord({ faviconPath, flyerPath, label: event.name });
    if (record) {
      const entry = { slug: event.slug };
      const entryUrl = websiteUrl || eventFaviconUrl || (prev && prev.url);
      if (entryUrl) entry.url = entryUrl;
      // Never lose an existing legacy pair just because this run found no
      // favicon on disk — those two fields are a stable published contract.
      if (!record.bg && prev && prev.faviconBg) {
        entry.faviconBg = prev.faviconBg;
        entry.faviconFg = prev.faviconFg;
      }
      assignColorFields(entry, record);
      existingBySlug.set(event.slug, entry);
      const artwork = record.paletteSource === 'flyer' ? path.relative(ROOT, flyerPath) : path.basename(faviconPath || '');
      console.log(`  ✅ ${event.name} — ${describeRecord(record)} (${artwork})`);
      // Re-extraction is deterministic, so an unchanged entry must not rewrite
      // the file — a --force sweep should leave a clean git status.
      if (JSON.stringify(prev) !== JSON.stringify(entry)) changed = true;
    }
  }

  // Sibling inheritance: an event whose favicon file never made it to disk
  // (ticketing-platform URL, not-yet-downloaded variant) must not render a
  // default plate while a same-brand sibling carries the extracted pair.
  // Brand identity = the event's favicon field when it is entity-specific,
  // else its chosen URL — the same precedence the site displays.
  const faviconIdentityKey = (event) => {
    const fav = typeof event.favicon === 'string' && event.favicon && !isGenericPlatformUrl(event.favicon)
      ? event.favicon : null;
    const raw = fav || chooseBestUrl(event);
    return raw ? String(raw).trim().toLowerCase().replace(/\/+$/, '') : null;
  };
  const eventBySlug = new Map(events.filter(e => e && e.slug).map(e => [e.slug, e]));
  const donorByKey = new Map();
  for (const [slug, entry] of existingBySlug) {
    if (!entry.faviconBg || !entry.faviconFg) continue;
    const ev = eventBySlug.get(slug);
    const key = ev ? faviconIdentityKey(ev) : null;
    if (key && !donorByKey.has(key)) donorByKey.set(key, entry);
  }
  for (const event of events) {
    if (!event.slug) continue;
    const key = faviconIdentityKey(event);
    if (!key) continue;
    const donor = donorByKey.get(key);
    if (!donor) continue;
    let entry = existingBySlug.get(event.slug);
    if (entry && entry.faviconBg && entry.faviconFg) continue;
    if (!entry) {
      entry = { slug: event.slug };
      const inheritUrl = chooseBestUrl(event);
      if (inheritUrl) entry.url = inheritUrl;
      existingBySlug.set(event.slug, entry);
    }
    if (entry.faviconBg !== donor.faviconBg || entry.faviconFg !== donor.faviconFg) {
      entry.faviconBg = donor.faviconBg;
      entry.faviconFg = donor.faviconFg;
      changed = true;
      console.log(`  🎨 ${event.name || event.slug} — inherited favicon colours from a same-brand sibling`);
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

  console.log('\n✅ Colour extraction complete.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});


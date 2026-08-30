#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const SITE_BASE = 'https://chunky.dad';
const OUTPUT_DIR = path.join(ROOT, 'img', 'og');
const FAVICONS_DIR = path.join(ROOT, 'img', 'favicons');
const LOGO_FILE = path.join(ROOT, 'Rising_Star_Ryan_Head_Compressed.png');

// The card design itself — shared with testing/test-og-event-layouts-calendar.html
// so the studio previews exactly what ships.
const { buildOgCardHtml } = require('./og-card.js');

// Favicon filenames are derived from the website URL, never from what actually
// landed on disk — the same contract download-images.js and
// extract-favicon-colors.js work to.
const {
  convertWebsiteUrlToFaviconPath,
  generateLinktreeFaviconFilename,
  generateWikipediaFaviconFilename,
  isLinktreeUrl,
  isWikipediaUrl
} = require(path.join(ROOT, 'js', 'filename-utils.js'));

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

// ---------------------------------------------------------------------------
// The data the card paints
// ---------------------------------------------------------------------------

/**
 * Per-event colour records for a city, keyed by slug: the WHOLE record
 * (palette, accent, faviconBg/Fg, faviconPlate, url), because the card derives
 * its three aurora stops from the palette exactly as the site's cards do.
 */
function loadEventColors(cityKey) {
  const colorsFile = path.join(ROOT, 'data', 'event-colors', `${cityKey}.json`);
  if (!fs.existsSync(colorsFile)) return new Map();
  try {
    const entries = JSON.parse(fs.readFileSync(colorsFile, 'utf8'));
    const map = new Map();
    for (const entry of entries) {
      // A palette alone is enough — events whose only artwork is a flyer carry
      // no faviconBg at all, and their colours are the best ones we have.
      if (entry && entry.slug && (entry.faviconBg || typeof entry.palette === 'string')) {
        map.set(entry.slug, entry);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Bar colour records for a city, keyed by lower-cased bar name — the fallback
 * when an event has no extracted colours of its own.
 */
function loadBarColors(cityKey) {
  const barsFile = path.join(ROOT, 'data', 'bars', `${cityKey}.json`);
  if (!fs.existsSync(barsFile)) return new Map();
  try {
    const bars = JSON.parse(fs.readFileSync(barsFile, 'utf8'));
    const map = new Map();
    for (const bar of bars) {
      if (bar && bar.name && (bar.faviconBg || typeof bar.palette === 'string')) {
        map.set(bar.name.toLowerCase(), bar);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * The already-downloaded favicon for a website URL, as a file:// URL for the
 * renderer (no network, so a slow CDN can never cost the card its tile).
 * Mirrors localFaviconPath() in tools/extract-favicon-colors.js — same
 * filename rules, same 64px-then-256px preference.
 */
function localFaviconUrl(websiteUrl) {
  const raw = String(websiteUrl || '').trim();
  if (!raw) return '';
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const candidates = [];
  try {
    if (isWikipediaUrl(url)) {
      for (const size of ['64', '256']) candidates.push(generateWikipediaFaviconFilename(url, size));
    } else if (isLinktreeUrl(url)) {
      for (const size of ['64', '256']) candidates.push(generateLinktreeFaviconFilename(url, size));
    } else {
      const base = path.basename(convertWebsiteUrlToFaviconPath(url));
      for (const size of ['64', '256']) candidates.push(base.replace(/(-\d+px)/, `-${size}px`));
      candidates.push(base);
    }
  } catch {
    return '';
  }
  for (const name of candidates) {
    const full = path.join(FAVICONS_DIR, name);
    if (fs.existsSync(full)) return fileUrl(full);
  }
  return '';
}

function fileUrl(absolutePath) {
  return `file://${absolutePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

// Undo the entity escaping generate-event-pages.js applies to meta content.
function unescapeMeta(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// One <meta name="chunky:…"> value out of a stub, unescaped.
function readCardMeta(html, name) {
  const match = html.match(new RegExp(`<meta name="chunky:${name}" content="([^"]*)"`));
  return match ? unescapeMeta(match[1]) : '';
}

// The bear, from disk — the card's only other image, and one more thing that
// never has to survive a network round trip.
const logoUrl = fs.existsSync(LOGO_FILE) ? fileUrl(LOGO_FILE) : '';

// The card is set in Poppins, the site's own face. Screenshotting before it
// arrives quietly ships a system-ui card, so wait for it — but never for long:
// a blocked fonts.googleapis.com should cost a fallback face, not the build.
async function waitForFonts(page) {
  try {
    await page.evaluate(() => Promise.race([
      document.fonts.ready,
      new Promise(resolve => setTimeout(resolve, 2500))
    ]));
  } catch {
    // rendering continues in the fallback stack
  }
}

/**
 * Every event that needs a share image, with the card data to paint it.
 * Exported so the studio tooling (and a dry run) can build the exact same
 * cards without launching a browser.
 */
function collectTargets() {
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

      const cityFromCanonical = (html.match(/<link rel="canonical" href="\/([^/]+)\//) || [])[1] || cityKey;

      // The stub carries the card's fields directly (generate-event-pages.js
      // writes them from the real event). The og:* fallbacks below only matter
      // for a stub written before those metas existed — the two generators run
      // in the same workflow, so in practice the metas are always there.
      const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
      const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
      const ogTitle = titleMatch ? unescapeMeta(titleMatch[1]) : `${cityKey} event`;
      const desc = descMatch ? unescapeMeta(descMatch[1]) : '';

      // og:title is "<Event> – <City> – chunky.dad"; the card wants the event.
      const title = readCardMeta(html, 'name') || ogTitle.split(' – ')[0] || ogTitle;
      // the card prints the ADDRESS (chunky.dad/nyc), so it wants the URL
      // segment this page lives under, not the city's display name
      const cityPath = cityFromCanonical;
      const venuePart = desc.split(' · ').find(p => p.startsWith('@ ')) || '';
      const venue = readCardMeta(html, 'venue') || venuePart.replace(/^@\s*/, '');
      const when = readCardMeta(html, 'when')
        || desc.split(' · ').filter(p => !p.startsWith('@ ')).join(' · ');
      const cover = readCardMeta(html, 'cover');
      const website = readCardMeta(html, 'website');

      // Colours: the event's own artwork first, the venue bar's as a fallback —
      // an event with no flyer and no favicon still belongs to its bar's brand.
      const colors = eventColors.get(evDir.name)
        || (venue ? barColors.get(venue.toLowerCase()) : null)
        || null;

      // The event's flyer, written into the stub by generate-event-pages.js
      // (landscape candidate preferred — this artboard is 1200×630).
      const flyerUrl = readCardMeta(html, 'flyer');

      // The favicon tile: the local file, resolved from whichever URL the
      // colour extractor used, so the tile and the aurora come from one brand.
      const faviconUrl = localFaviconUrl((colors && colors.url) || website);

      targets.push({
        cityKey: cityFromCanonical, slug: evDir.name,
        card: { title, cityPath, when, venue, cover, flyerUrl, faviconUrl, colors, logoUrl }
      });
    }
  }

  return targets;
}

async function main() {
  const targets = collectTargets();

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
      // The flyer is the only part of the card that needs the network; drop it
      // and everything else (aurora, favicon tile, logo, type) is local.
      const offlineCard = { ...t.card, flyerUrl: '' };
      let rendered = false;
      try {
        await page.setContent(buildOgCardHtml(t.card), { waitUntil: 'networkidle0', timeout: 20000 });
        await waitForFonts(page);
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
          await page.setContent(buildOgCardHtml(offlineCard), { waitUntil: 'domcontentloaded', timeout: 15000 });
          await waitForFonts(page);
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

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error generating OG images:', err);
    process.exit(1);
  });
}

module.exports = { collectTargets, localFaviconUrl };


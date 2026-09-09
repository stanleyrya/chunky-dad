#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const SITE_BASE = 'https://chunky.dad';
const OUTPUT_DIR = path.join(ROOT, 'img', 'og');
const FAVICONS_DIR = path.join(ROOT, 'img', 'favicons');
// The site icon at 96px (18KB) rather than Rising_Star_Ryan_Head_Compressed.png
// (1.4MB) — it is painted into a 36px slot, and it is inlined into every card.
const LOGO_FILE = path.join(ROOT, 'favicons', 'favicon-96x96.png');

// The card design itself — shared with testing/test-og-event-layouts-calendar.html
// so the studio previews exactly what ships.
const { buildOgCardHtml, OG_TEMPLATE_VERSION, OG_PLACE_TEMPLATE_VERSION } = require('./og-card.js');

// Favicon filenames are derived from the website URL, never from what actually
// landed on disk — the same contract download-images.js and
// extract-favicon-colors.js work to.
// The city's own framing — the same centre and zoom the city page opens its
// map at, so the corner map is recognisably that city.
const { getCityConfig } = require(path.join(ROOT, 'js', 'city-config.js'));

const {
  convertWebsiteUrlToFaviconPath,
  generateLinktreeFaviconFilename,
  generateWikipediaFaviconFilename,
  isLinktreeUrl,
  isWikipediaUrl,
  simpleHash
} = require(path.join(ROOT, 'js', 'filename-utils.js'));

// Which events deserve a card, where cards live, and how to find the flyer
// copy already on disk.
const { CARD_EXT, buildFlyerIndex, localFlyerFor } = require('./og-policy.js');

// A card is re-rendered only when its CONTENT changes.
//
// The old gate compared rendered bytes, which sounds equivalent and is not: the
// card used to paint the flyer straight off its origin, so a re-encoded or
// merely reordered remote image produced different pixels and a fresh commit.
// img/og/new-york/goldiloxx-6c462174.png was rewritten 424 times that way, and
// img/og grew to 602 MB — a third of the whole repository's history. The stub
// already carries the content hash of everything the card paints, as the ?v=
// cache-buster on its og:image, so that number is the gate. Reusing it rather
// than recomputing means the two generators cannot drift apart.
const MANIFEST_FILE = path.join(OUTPUT_DIR, 'manifest.json');

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  } catch {
    return {};
  }
}

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
 * The already-downloaded favicon for a website URL, as an absolute path (the
 * caller inlines it — no network, so a slow CDN can never cost the card its
 * tile). Mirrors localFaviconPath() in tools/extract-favicon-colors.js — same
 * filename rules, same 64px-then-256px preference.
 */
function localFaviconFile(websiteUrl) {
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
    if (fs.existsSync(full)) return full;
  }
  return '';
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

/**
 * A local image as a data: URI, so the card carries its own pixels.
 *
 * This is not fussiness. The first CI run of this generator (branch
 * rail-edges-and-og-cards, 2026-08-30) came back with no favicon tile and no
 * logo on any card: setContent() leaves the page on an about:blank origin,
 * and Chromium refuses file:// subresources from one, so both images hit
 * their onerror and removed themselves. WebKit loads them locally, which is
 * exactly why only a real run could show it. Inlined, the card depends on the
 * network for nothing but the flyer, and renders the same anywhere.
 *
 * Cached: one logo and a few dozen favicons are shared across hundreds of events.
 */
const dataUriCache = new Map();
const DATA_URI_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
function dataUri(absolutePath) {
  if (!absolutePath) return '';
  if (dataUriCache.has(absolutePath)) return dataUriCache.get(absolutePath);
  let uri = '';
  try {
    const mime = DATA_URI_MIME[path.extname(absolutePath).toLowerCase()];
    if (mime) uri = `data:${mime};base64,${fs.readFileSync(absolutePath).toString('base64')}`;
  } catch {
    uri = '';
  }
  dataUriCache.set(absolutePath, uri);
  return uri;
}

/**
 * Every card reports itself settled through window.__ogReady — fonts loaded,
 * art layout chosen, rows fitted, and the corner map painted if it has one
 * (see readyScript in tools/og-card.js). It resolves on failure too, so this
 * waits for an answer, never for success.
 */
async function waitForCard(page) {
  try {
    await page.evaluate(() => window.__ogReady || Promise.resolve());
  } catch {
    // the card paints without its map
  }
}

// The bear, inlined once and reused by every card.
const logoUrl = dataUri(LOGO_FILE);

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
  // Built once: every downloaded flyer, keyed by the URL it came from.
  const flyerIndex = buildFlyerIndex();

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

      // The stub decides whether this event still gets a card of its own.
      // generate-event-pages.js points og:image either at the per-event card or
      // at the city's card (for events long past), so honouring that pointer
      // keeps the two tools in agreement by construction instead of by having
      // the same date rule written out twice.
      const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
      const ogImage = ogImageMatch ? ogImageMatch[1] : '';
      const wantsOwnCard = ogImage.includes(`/img/og/${cityFromCanonical}/`);
      if (!wantsOwnCard) continue;
      // the ?v= hash of everything the card paints — our render gate
      const version = (ogImage.match(/[?&]v=([0-9a-f]+)/) || [])[1] || '';

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
      const remoteFlyer = readCardMeta(html, 'flyer');
      // Paint the copy already on disk. download-images.js runs earlier in the
      // same workflow, so it is nearly always there; inlining it means the card
      // needs the network for nothing, renders the same every time, and can no
      // longer be derailed by a slow flyer host. The remote URL stays as the
      // fallback for artwork that has not been fetched yet.
      const localFlyer = localFlyerFor(remoteFlyer, flyerIndex, simpleHash);
      const flyerUrl = localFlyer ? dataUri(localFlyer) : remoteFlyer;

      // Where it happens. Carried on every card, drawn only when the card is
      // built with showMap (the corner map is an option, not the default —
      // see tools/og-card.js). Needs the event's coordinates AND the city's
      // home framing; without both there is nothing to draw.
      const lat = Number(readCardMeta(html, 'lat'));
      const lng = Number(readCardMeta(html, 'lng'));
      const city = getCityConfig(cityFromCanonical);
      const cityPoint = city && city.coordinates;
      const map = (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
        && cityPoint && Number.isFinite(Number(cityPoint.lat)) && Number.isFinite(Number(cityPoint.lng)))
        ? {
            lat, lng,
            cityLat: Number(cityPoint.lat),
            cityLng: Number(cityPoint.lng),
            cityZoom: Number(city.mapZoom) || 11
          }
        : null;

      // The favicon tile: the local file, resolved from whichever URL the
      // colour extractor used, so the tile and the aurora come from one brand.
      const faviconUrl = dataUri(localFaviconFile((colors && colors.url) || website));

      targets.push({
        cityKey: cityFromCanonical, slug: evDir.name, version, localFlyer: Boolean(localFlyer),
        card: { title, cityPath, when, venue, cover, flyerUrl, faviconUrl, colors, logoUrl, map }
      });
    }
  }

  return targets;
}

/**
 * Remove cards nothing points at any more.
 *
 * Two things strand them. A card whose event has aged past its grace period is
 * no longer requested by its stub; and because an event's slug is derived from
 * its NAME, renaming one in the calendar mints a fresh slug and abandons the
 * old file forever — img/og/nyc held 21 goldiloxx cards, 20 of them dead. The
 * generator only ever wrote, so nothing had ever cleaned either kind up.
 */
function pruneCards(keep) {
  if (!fs.existsSync(OUTPUT_DIR)) return 0;
  let removed = 0;
  for (const cityDir of fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })) {
    if (!cityDir.isDirectory()) continue;
    const dir = path.join(OUTPUT_DIR, cityDir.name);
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      if (!fs.statSync(full).isFile()) continue;
      if (keep.has(full)) continue;
      fs.unlinkSync(full);
      removed++;
      console.log(`🗑️  Removed orphaned ${path.relative(ROOT, full)}`);
    }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
  return removed;
}

/**
 * The cards for places rather than events: one per visible city, plus the home
 * page. Before this, /nyc/ shared a 1.3 MB photograph of the owner's head at
 * the wrong aspect ratio and emitted no twitter:image at all, and the home page
 * shared a 512x512 square — neither is a link preview.
 *
 * Deliberately free of counts. A number would be stale the moment Facebook
 * cached it, and would re-render 24 cards every time an event rolled off a
 * calendar. Name, tagline and map are true indefinitely, so these render once.
 */
/**
 * The venues a city card pins: the places that city's scene actually happens
 * in, most-used first, one pin per venue.
 *
 * Ranked by how many events a venue holds (recurring ones first, since a
 * weekly is more "this is the scene here" than a one-off), then alphabetically
 * so the choice is stable run to run. Capped, because a map of a dozen
 * overlapping tiles reads as clutter rather than as a city.
 */
function collectCityPins(cityKey, limit = 8) {
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'calendars', `${cityKey}.json`), 'utf8')).events || [];
  } catch {
    return [];
  }
  const eventColors = loadEventColors(cityKey);
  const barColors = loadBarColors(cityKey);

  const byVenue = new Map();
  for (const ev of events) {
    const lat = Number(ev && ev.coordinates && ev.coordinates.lat);
    const lng = Number(ev && ev.coordinates && ev.coordinates.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    // festivals are city-wide, not a venue, and would pin an arbitrary point
    if (ev.festival) continue;
    const key = String(ev.bar || ev.slug || '').toLowerCase();
    if (!key) continue;
    if (!byVenue.has(key)) byVenue.set(key, { key, lat, lng, count: 0, recurring: false, event: ev });
    const slot = byVenue.get(key);
    slot.count++;
    if (ev.recurring) slot.recurring = true;
  }

  return [...byVenue.values()]
    .sort((a, b) => (b.recurring - a.recurring) || (b.count - a.count) || a.key.localeCompare(b.key))
    .map(slot => {
      const colors = eventColors.get(slot.event.slug) || barColors.get(slot.key) || null;
      const website = (colors && colors.url) || slot.event.website
        || (barColors.get(slot.key) && barColors.get(slot.key).website);
      const icon = dataUri(localFaviconFile(website));
      if (!icon) return null;   // a blank tile says nothing; better no pin
      const plate = colors && /^#[0-9a-fA-F]{3,8}$/.test(colors.faviconPlate || '') ? colors.faviconPlate : '#ffffff';
      return { lat: slot.lat, lng: slot.lng, icon, plate };
    })
    .filter(Boolean)
    // Deliberately NOT deduped by icon. Three venues under one operator are
    // three real places, and Provincetown is exactly that — collapsing them by
    // brand left it with a single pin. Tiles that genuinely overlap on the
    // finished map are dropped there instead, where their pixel positions are
    // actually known.
    .slice(0, limit);
}

/**
 * One tile per dated run: its favicon on its plate. Dated only — a run with
 * no nextDates is not on the calendar this card is for. Ordered by start
 * date so the cluster is stable run to run and the render gate holds.
 * Plates come from data/event-colors/bear-runs.json, which the colour
 * extractor writes for every festival under the same festival-<key>-<year>
 * slug the site renders them by; a run with no entry yet gets a white plate.
 */
function collectRunTiles() {
  let festivals = [];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'festivals.json'), 'utf8'));
    festivals = Array.isArray(raw) ? raw : (raw.festivals || []);
  } catch {
    return [];
  }
  const colors = loadEventColors('bear-runs');
  return festivals
    .filter(f => f && f.website && f.nextDates && f.nextDates.start && f.nextDates.end)
    .sort((a, b) => String(a.nextDates.start).localeCompare(String(b.nextDates.start)))
    .map(f => {
      const year = new Date(`${f.nextDates.start}T00:00:00`).getFullYear();
      const entry = colors.get(`festival-${f.key}-${year}`);
      // Only a run the colour extractor accepted. It already refuses platform
      // sites (Eventbrite, Instagram) and artwork it cannot read a brand from,
      // and the tiles those produced were the worst thing on the card: two
      // blank white squares, a grey placeholder cube, and Instagram's own
      // logo standing in for Bear Pride Chicago. No tile beats a wrong one.
      if (!entry) return null;
      // NOT filtered on `accent`. That looked like the way to drop a host's
      // grey placeholder cube (IBC), but black-and-white marks — Folsom Street
      // Fair, Urban Bear NYC, Sugar Bear — are colourless by design and carry
      // no accent either; the rule threw out three real logos to lose one
      // fake. A placeholder favicon is a data problem: curate the icon for
      // that domain and it corrects here and on every card at once.
      const icon = dataUri(localFaviconFile(f.website));
      if (!icon) return null;
      const plate = /^#[0-9a-fA-F]{3,8}$/.test(entry.faviconPlate || '') ? entry.faviconPlate : '#ffffff';
      return { icon, plate };
    })
    .filter(Boolean);
}

function collectPlaceTargets() {
  const { CITY_CONFIG } = require(path.join(ROOT, 'js', 'city-config.js'));
  const out = [];

  for (const [cityKey, cfg] of Object.entries(CITY_CONFIG)) {
    if (!cfg || cfg.visible === false) continue;
    const point = cfg.coordinates || {};
    const hasPoint = Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
    out.push({
      kind: 'city',
      key: cityKey,
      outPath: path.join(OUTPUT_DIR, 'city', `${cityKey}${CARD_EXT}`),
      manifestKey: `city/${cityKey}`,
      card: {
        kind: 'city',
        title: cfg.name || cityKey,
        // No tagline. "What's the bear 411?" is a catchphrase, and a share
        // card is not the place for one — the map and the venues on it say
        // what this city is far better than a slogan does.
        cityPath: cityKey,
        logoUrl,
        showMap: hasPoint,
        map: hasPoint ? {
          lat: Number(point.lat), lng: Number(point.lng),
          cityLat: Number(point.lat), cityLng: Number(point.lng),
          cityZoom: Number(cfg.mapZoom) || 11,
          pins: collectCityPins(cityKey)
        } : null
      }
    });
  }

  // The bear-runs calendar. No map: the runs carry no coordinates, and the
  // home-style card (name and a line, on the ground) is the honest one.
  out.push({
    kind: 'home',
    key: 'bear-runs',
    outPath: path.join(OUTPUT_DIR, `bear-runs${CARD_EXT}`),
    manifestKey: 'bear-runs',
    card: {
      kind: 'runs',
      title: 'Bear Runs',
      when: 'Bear weeks, runs and festivals, the whole year on one calendar',
      cityPath: 'bear-runs',
      logoUrl,
      // one favicon tile per dated run, on its plate colour
      tiles: collectRunTiles()
    }
  });

  out.push({
    kind: 'home',
    key: 'home',
    outPath: path.join(OUTPUT_DIR, `home${CARD_EXT}`),
    manifestKey: 'home',
    card: {
      kind: 'home',
      title: 'Your Gay Bear Travel Guide',
      when: 'Events, bars and bear weeks, city by city',
      cityPath: '',
      logoUrl
    }
  });

  return out;
}

async function main() {
  const targets = collectTargets();

  // City and home cards join the same queue, gated the same way. Added before
  // the empty check: a run with no event cards due (every stub unchanged, or a
  // calendar outage) must still be able to produce the place cards.
  for (const place of collectPlaceTargets()) {
    place.version = crypto.createHash('md5')
      .update(JSON.stringify({
        card: place.card,
        template: OG_TEMPLATE_VERSION,
        // place cards have no event data, so their own layout version is the
        // only thing that can tell the gate a CSS-only redesign happened
        placeTemplate: OG_PLACE_TEMPLATE_VERSION
      }))
      .digest('hex').slice(0, 8);
    targets.push(place);
  }

  const manifest = loadManifest();
  const nextManifest = {};
  const keep = new Set();
  const pending = [];
  for (const t of targets) {
    const outPath = t.outPath || path.join(OUTPUT_DIR, t.cityKey, `${t.slug}${CARD_EXT}`);
    t.outPath = outPath;
    keep.add(outPath);
    const key = t.manifestKey || `${t.cityKey}/${t.slug}`;
    nextManifest[key] = t.version;
    // Unchanged content AND the file is still there: nothing to do. This is
    // what stops the churn — no browser is launched for it at all.
    if (t.version && manifest[key] === t.version && fs.existsSync(outPath)) continue;
    pending.push(t);
  }

  if (targets.length === 0) {
    console.log('No OG images to generate.');
    return;
  }

  const pruned = pruneCards(keep);
  console.log(`${targets.length} card(s) wanted · ${pending.length} to render · ${targets.length - pending.length} unchanged · ${pruned} pruned`);

  if (pending.length === 0) {
    ensureDir(OUTPUT_DIR);
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(nextManifest, null, 2) + '\n');
    console.log('No OG image changes.');
    return;
  }

  const { default: puppeteer } = await getPuppeteer();
  // MapLibre needs WebGL, and headless Chrome only has the software path —
  // which Chrome 127+ refuses to use unless it is told to. Harmless for the
  // cards that draw no map; required the day the corner map ships.
  const browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });
  let changes = 0;
  try {
    for (const t of pending) {
      let page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
      // The flyer is the only part of the card that needs the network; drop it
      // and everything else (aurora, favicon tile, logo, type) is local.
      const offlineCard = { ...t.card, flyerUrl: '' };
      let rendered = false;
      try {
        await page.setContent(buildOgCardHtml(t.card), { waitUntil: 'networkidle0', timeout: 20000 });
        await waitForFonts(page);
        await waitForCard(page);
        rendered = true;
      } catch (err) {
        // A slow or unreachable flyer host must never fail the build: fall back
        // to the text-only card, which needs no network at all.
        console.warn(`⚠️  Flyer render timed out for ${t.manifestKey || t.cityKey + '/' + t.slug}; using text-only card`);
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
          await waitForCard(page);
          rendered = true;
        } catch (fallbackError) {
          console.warn(`⚠️  Skipping OG image for ${t.manifestKey || t.cityKey + '/' + t.slug}: ${fallbackError.message}`);
        }
      }
      if (rendered) {
        // JPEG at 82: these are photographs over a gradient, where PNG's
        // lossless promise bought nothing and cost ~273 KB a card.
        const buffer = await page.screenshot({ type: 'jpeg', quality: 82 });
        const outPath = t.outPath;
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

  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(nextManifest, null, 2) + '\n');

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

module.exports = { collectTargets, collectPlaceTargets, collectCityPins, localFaviconFile };


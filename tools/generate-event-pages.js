#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');

// Load CITY_CONFIG from js/city-config.js (Node-compatible export exists)
let CITY_CONFIG;
try {
  const cityModule = require(path.join(ROOT, 'js', 'city-config.js'));
  CITY_CONFIG = cityModule.CITY_CONFIG || {};
} catch (e) {
  console.error('Failed to load CITY_CONFIG from js/city-config.js:', e.message);
  process.exit(1);
}

// Load CalendarCore for ICS parsing (Node-compatible after DOM guard)
let CalendarCore;
try {
  CalendarCore = require(path.join(ROOT, 'js', 'calendar-core.js'));
} catch (e) {
  console.error('Failed to load CalendarCore:', e.message);
  process.exit(1);
}

// Simple logger shim for Node environment to satisfy references
global.logger = {
  debug() {}, info() {}, warn() {}, error() {}, componentInit() {}, componentLoad() {}, componentError() {}, time() {}, timeEnd() {}, apiCall() {}, performance() {}
};

// Config
const OUTPUT_DAYS_WINDOW = parseInt(process.env.EVENT_STUB_DAYS || '180', 10); // Upcoming days to generate
const MARKER = '<!-- generated: chunky.dad event page -->';
const SITE_BASE = 'https://chunky.dad';
const FALLBACK_IMAGE = `${SITE_BASE}/Rising_Star_Ryan_Head_Compressed.png`;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) return false;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return true;
}

function sanitize(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getIcsPath(cityKey) {
  return path.join(ROOT, 'data', 'calendars', `${cityKey}.ics`);
}

function withinWindow(date, now, days) {
  if (!date) return false;
  const diffMs = date.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= -2 && diffDays <= days; // small negative tolerance for late events
}

function buildEventHtml(cityKey, cityName, event) {
  const title = `${sanitize(event.name)} – ${cityName} – chunky.dad`;
  const descriptionParts = [];
  if (event.day) descriptionParts.push(event.day);
  if (event.time) descriptionParts.push(event.time);
  if (event.bar) descriptionParts.push(`@ ${event.bar}`);
  const description = sanitize(descriptionParts.join(' · ')) || `${cityName} bear event`;
  const url = `${SITE_BASE}/${cityKey}/${encodeURIComponent(event.slug)}/`;
  // Prefer generated per-event OG image and add a content-hash version for cache busting
  const generatedPng = `/img/og/${cityKey}/${encodeURIComponent(event.slug)}.png`;
  let version = '';
  try {
    const seed = JSON.stringify({
      name: event.name || '',
      day: event.day || '',
      time: event.time || '',
      bar: event.bar || '',
      cover: event.cover || '',
      description: event.tea || event.unprocessedDescription || ''
    });
    version = crypto.createHash('md5').update(seed).digest('hex').slice(0, 8);
  } catch (e) {
    version = '';
  }
  const generatedUrl = `${SITE_BASE}${generatedPng}${version ? `?v=${version}` : ''}`;
  const ogImage = generatedUrl;

  const canonical = `/${cityKey}/`;
  const redirectTarget = `../?event=${encodeURIComponent(event.slug)}`;

  return `<!DOCTYPE html>
${MARKER}
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ogImage}">
  <meta http-equiv="refresh" content="0; url=${redirectTarget}">
</head>
<body>
  <noscript><meta http-equiv="refresh" content="0; url=${redirectTarget}"></noscript>
  <script>location.replace(${JSON.stringify(redirectTarget)});</script>
</body>
</html>`;
}

function pruneOldEventDirs(cityKey, validSlugs) {
  const cityDir = path.join(ROOT, cityKey);
  if (!fs.existsSync(cityDir)) return 0;
  let removed = 0;
  const entries = fs.readdirSync(cityDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slugDir = path.join(cityDir, ent.name);
    const indexFile = path.join(slugDir, 'index.html');
    if (fs.existsSync(indexFile)) {
      const html = fs.readFileSync(indexFile, 'utf8');
      if (html.includes('generated: chunky.dad event page') && !validSlugs.has(ent.name)) {
        fs.rmSync(slugDir, { recursive: true, force: true });
        removed++;
      }
    }
  }
  return removed;
}

async function main() {
  let totalChanges = 0;
  const now = new Date();
  const calendar = new CalendarCore();

  const visibleCities = Object.entries(CITY_CONFIG).filter(([, cfg]) => cfg && cfg.visible !== false);
  for (const [cityKey, cfg] of visibleCities) {
    const icsPath = getIcsPath(cityKey);
    if (!fs.existsSync(icsPath)) {
      console.log(`⏭️  No ICS for ${cityKey}, skipping event pages`);
      continue;
    }

    const icalText = fs.readFileSync(icsPath, 'utf8');
    const events = calendar.parseICalData(icalText) || [];
    const upcoming = events.filter(ev => withinWindow(ev.startDate, now, OUTPUT_DAYS_WINDOW));

    // Map by slug to guarantee unique stubs
    const uniqueBySlug = new Map();
    for (const ev of upcoming) {
      if (!ev.slug) continue;
      if (!uniqueBySlug.has(ev.slug)) uniqueBySlug.set(ev.slug, ev);
    }

    const validSlugs = new Set(uniqueBySlug.keys());
    let cityChanges = 0;

    // Write stubs
    for (const [slug, ev] of uniqueBySlug.entries()) {
      const outFile = path.join(ROOT, cityKey, slug, 'index.html');
      const html = buildEventHtml(cityKey, cfg.name || cityKey, ev);
      if (writeIfChanged(outFile, html)) {
        cityChanges++;
        console.log(`✓ Wrote ${path.relative(ROOT, outFile)}`);
      } else {
        console.log(`⏭️  No change for ${path.relative(ROOT, outFile)}`);
      }
    }

    // Prune removed events for this city (only our generated ones)
    const removed = pruneOldEventDirs(cityKey, validSlugs);
    if (removed > 0) cityChanges += removed;

    if (cityChanges > 0) totalChanges += cityChanges;
  }

  if (totalChanges === 0) {
    console.log('No event pages changed.');
  } else {
    console.log(`Event page generation complete. ${totalChanges} change(s).`);
  }
}

main().catch(err => {
  console.error('Fatal error generating event pages:', err);
  process.exit(1);
});


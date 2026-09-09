#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve project root relative to this script
const ROOT = path.resolve(__dirname, '..');

const { cityCardRelPath } = require('./og-policy.js');

// The content hash of the city's generated card, recorded by
// tools/generate-og-images.js. Absent on a first run (that generator lives in a
// different workflow), in which case the page ships an unversioned URL and
// picks the hash up on the next regeneration.
let cardManifest = null;
function cardVersion(manifestKey) {
  if (cardManifest === null) {
    try {
      cardManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'img', 'og', 'manifest.json'), 'utf8'));
    } catch {
      cardManifest = {};
    }
  }
  return cardManifest[manifestKey] || '';
}
function cityCardVersion(cityKey) {
  return cardVersion(`city/${cityKey}`);
}

// Load CITY_CONFIG via Node export
let CITY_CONFIG;
try {
  const cityModule = require(path.join(ROOT, 'js', 'city-config.js'));
  CITY_CONFIG = cityModule.CITY_CONFIG || {};
} catch (e) {
  console.error('Failed to load CITY_CONFIG from js/city-config.js:', e.message);
  process.exit(1);
}

// Read the base template (city.html)
const templatePath = path.join(ROOT, 'city.html');
if (!fs.existsSync(templatePath)) {
  console.error('city.html not found at project root');
  process.exit(1);
}
const templateHtml = fs.readFileSync(templatePath, 'utf8');

const CITY_MARKER = '<!-- generated: chunky.dad city page -->';
const ALIAS_MARKER = '<!-- generated: chunky.dad city alias redirect -->';

// Utility: ensure directory exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

// Generate pre-populated header with city selector
function generateCityHeader(html, cityKey, cityConfig) {
  // Get all available cities for the dropdown — same ordering rule as the
  // homepage strip: `order`-pinned cities first, then config-file order
  const availableCities = Object.entries(CITY_CONFIG)
    .filter(([, cfg]) => cfg && cfg.visible !== false)
    .map(([key, cfg]) => ({ key, ...cfg }))
    .sort((a, b) => (a.order || Number.MAX_SAFE_INTEGER) - (b.order || Number.MAX_SAFE_INTEGER));

  // Build city dropdown options HTML with direct links
  const cityOptions = availableCities.map(city => `
                            <a href="../${city.key}/" class="city-option" data-city-key="${city.key}">
                                <span class="city-option-emoji">${city.emoji}</span>
                                <span class="city-option-name">${city.name}</span>
                            </a>`).join('');

  // Create complete header HTML with pre-populated city selector
  const headerHtml = `    <header>
        <nav>
            <div class="nav-container">
                <div class="logo">
                    <h1><a href="../index.html"><img src="../Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad logo" class="logo-img"> chunky.dad/${cityKey}</a></h1>
                </div>
                
                <!-- Pure HTML/CSS city selector -->
                <div class="city-switcher">
                    <input type="checkbox" id="city-switcher-toggle" class="city-switcher-toggle">
                    <label for="city-switcher-toggle" class="city-switcher-btn" aria-label="Switch city - currently ${cityConfig.name}">
                        <span class="city-emoji">${cityConfig.emoji}</span>
                        <span class="city-name">${cityConfig.name}</span>
                        <span class="city-carrot">▼</span>
                    </label>
                    <div class="city-dropdown">${cityOptions}
                    </div>
                </div>
                
                <div class="hamburger">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        </nav>
    </header>`;

  // Replace the existing header with the pre-generated one
  html = html.replace(/<header>[\s\S]*?<\/header>/, headerHtml);
  
  return html;
}

// Replace or inject head elements for per-city metadata
function buildCityHtml(baseHtml, cityKey, cityConfig) {
  let html = baseHtml;

  // Marker for generated pages (to allow safe cleanup later)
  if (!html.includes(CITY_MARKER)) {
    html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${CITY_MARKER}`);
  }

  // Generate pre-populated header with city selector
  html = generateCityHeader(html, cityKey, cityConfig);

  // Title
  const cityTitle = `${cityConfig.name} - chunky.dad Bear Guide`;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${cityTitle}<\/title>`);

  // Meta description
  const cityDesc = `Complete gay bear guide to ${cityConfig.name} - events, bars, and the hottest bear scene`;
  if (html.match(/<meta name="description"[^>]*>/)) {
    html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${cityDesc}">`);
  } else {
    html = html.replace('</head>', `  <meta name="description" content="${cityDesc}">\n</head>`);
  }

  // Canonical link
  const canonicalHref = `/${cityKey}/`;
  if (html.match(/<link rel="canonical"[^>]*>/)) {
    html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${canonicalHref}">`);
  } else {
    html = html.replace('</head>', `  <link rel="canonical" href="${canonicalHref}">\n</head>`);
  }

  // Compute a stable version based on the city's ICS content to avoid daily commits
  const icsPath = path.join(ROOT, 'data', 'calendars', `${cityKey}.ics`);
  let ogVersion = '';
  if (fs.existsSync(icsPath)) {
    try {
      const data = fs.readFileSync(icsPath);
      ogVersion = crypto.createHash('sha256').update(data).digest('hex').slice(0, 8);
    } catch {}
  }

  // The city's own share card.
  //
  // This used to be Rising_Star_Ryan_Head_Compressed.png — a 1.3 MB portrait at
  // the wrong aspect ratio for every link-preview surface there is — and no
  // twitter:image was emitted at all. tools/generate-og-images.js now renders a
  // proper 1200x630 card per city (its name over its own map) and records the
  // card's content hash in img/og/manifest.json; that hash is the cache-buster,
  // so a redesign actually reaches the scrapers while a routine calendar change
  // does not needlessly bust it. The ICS hash still versions the page's data.
  const cardVersion = cityCardVersion(cityKey);
  const ogImageUrl = `https://chunky.dad${cityCardRelPath(cityKey)}${cardVersion ? `?v=${cardVersion}` : ''}`;

  const ogTags = [
    `<meta property="og:type" content="website">`,
    // shown above the title on Discord and similar; without it the card looks
    // like it came from nowhere
    `<meta property="og:site_name" content="chunky.dad">`,
    `<meta property="og:title" content="${cityTitle}">`,
    `<meta property="og:description" content="${cityDesc}">`,
    `<meta property="og:url" content="https://chunky.dad${canonicalHref}">`,
    `<meta property="og:image" content="${ogImageUrl}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${cityTitle}">`,
    `<meta name="twitter:description" content="${cityDesc}">`,
    `<meta name="twitter:image" content="${ogImageUrl}">`
  ].join('\n  ');

  if (!html.includes('property="og:title"')) {
    html = html.replace('</head>', `  ${ogTags}\n</head>`);
  } else {
    html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${cityTitle}">`)
               .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${cityDesc}">`)
               .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="https:\/\/chunky.dad${canonicalHref}">`);
    if (html.includes('property="og:image"')) {
      html = html.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${ogImageUrl}">`);
    } else {
      html = html.replace('</head>', `  <meta property="og:image" content="${ogImageUrl}">\n</head>`);
    }
    if (!html.includes('property="og:site_name"')) {
      html = html.replace('</head>', `  <meta property="og:site_name" content="chunky.dad">\n</head>`);
    }
    // twitter:* were simply absent before; add or refresh them alongside
    for (const [attr, value] of [['card', 'summary_large_image'], ['title', cityTitle], ['description', cityDesc], ['image', ogImageUrl]]) {
      const tag = `<meta name="twitter:${attr}" content="${value}">`;
      const existing = new RegExp(`<meta name="twitter:${attr}"[^>]*>`);
      html = existing.test(html) ? html.replace(existing, tag) : html.replace('</head>', `  ${tag}\n</head>`);
    }
  }

  return rewriteForSubdirectory(html, canonicalHref);
}

// Everything a page needs once it lives one directory down — shared by the
// city pages and the bear-runs calendar, which is built from the same template.
function rewriteForSubdirectory(html, canonicalHref) {
  // Pin relative-URL resolution to the page's directory.
  //
  // The page's URL no longer stays put: selecting an event rewrites the path to
  // /<city>/<slug>/ so the address bar always holds a link that previews with
  // that event's card. Without a <base>, document.baseURI would follow, and
  // every relative URL resolved AFTER that point — "../la/" in the city
  // switcher, "img/events/…" on a flyer, "data/calendars/<city>.json" on the
  // next fetch — would be a directory too deep and 404.
  //
  // The href is exactly where the document loads, so resolution is identical to
  // what it has always been; it simply stops depending on the visible path.
  if (!html.includes('<base ')) {
    html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n    <base href="${canonicalHref}">`);
  }

  // Rewrite asset and link paths for subdirectory depth
  html = html.replace(/href="(styles\.css)"/g, 'href="../$1"');
  html = html.replace(/src="js\//g, 'src="../js/');
  html = html.replace(/href="index\.html"/g, 'href="../index.html"');
  html = html.replace(/href="index\.html#/g, 'href="../index.html#');
  html = html.replace(/src="Rising_Star_Ryan_Head_Compressed\.png"/g, 'src="../Rising_Star_Ryan_Head_Compressed.png"');
  html = html.replace(/href="Rising_Star_Ryan_Head_Compressed\.png"/g, 'href="../Rising_Star_Ryan_Head_Compressed.png"');

  return html;
}

// The bear-runs calendar: the city template with a different event source.
//
// Same markup, same styling, same sheet — the loader keys the difference off
// the data-calendar attribute on <main> and loads every dated run from
// data/festivals.json instead of a city's calendar. No city switcher, since
// there is no city, and no Week button, since it is a month calendar.
const BEAR_RUNS_KEY = 'bear-runs';
function buildBearRunsHtml(baseHtml) {
  let html = baseHtml;
  if (!html.includes(CITY_MARKER)) {
    html = html.replace('<!DOCTYPE html>', `<!DOCTYPE html>\n${CITY_MARKER}`);
  }

  const canonicalHref = `/${BEAR_RUNS_KEY}/`;
  const title = 'Bear Runs - chunky.dad';
  const desc = 'Every bear run, bear week and festival on one calendar';

  // Header: the address, no switcher
  html = html.replace(/<header>[\s\S]*?<\/header>/, `    <header>
        <nav>
            <div class="nav-container">
                <div class="logo">
                    <h1><a href="../index.html"><img src="../Rising_Star_Ryan_Head_Compressed.png" alt="chunky.dad logo" class="logo-img"> chunky.dad/${BEAR_RUNS_KEY}</a></h1>
                </div>
                <div class="hamburger">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        </nav>
    </header>`);

  // The switch the loader reads, and no view toggle at all
  html = html.replace('<main class="city-page">', `<main class="city-page" data-calendar="${BEAR_RUNS_KEY}">`);
  html = html.replace(/\s*<div class="view-toggle">[\s\S]*?<\/div>/, '');

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}<\/title>`);
  html = html.match(/<meta name="description"[^>]*>/)
    ? html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${desc}">`)
    : html.replace('</head>', `  <meta name="description" content="${desc}">\n</head>`);
  html = html.match(/<link rel="canonical"[^>]*>/)
    ? html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${canonicalHref}">`)
    : html.replace('</head>', `  <link rel="canonical" href="${canonicalHref}">\n</head>`);

  const version = cardVersion(BEAR_RUNS_KEY);
  const ogImageUrl = `https://chunky.dad/img/og/${BEAR_RUNS_KEY}.jpg${version ? `?v=${version}` : ''}`;
  const ogTags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="chunky.dad">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="https://chunky.dad${canonicalHref}">`,
    `<meta property="og:image" content="${ogImageUrl}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${ogImageUrl}">`
  ].join('\n  ');
  html = html.replace('</head>', `  ${ogTags}\n</head>`);

  return rewriteForSubdirectory(html, canonicalHref);
}

// Build a redirect page for alias slugs
function buildAliasRedirectHtml(cityKey, cityConfig) {
  const target = `../${cityKey}/`;
  const canonicalHref = `/${cityKey}/`;
  const title = `${cityConfig.name} - chunky.dad`;
  return `<!DOCTYPE html>
${ALIAS_MARKER}
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="canonical" href="${canonicalHref}">
  <meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>
  <noscript><meta http-equiv="refresh" content="0; url=${target}"></noscript>
  <script>
    (function() {
      try {
        var target = ${JSON.stringify(target)};
        var search = window.location.search || '';
        var hash = window.location.hash || '';
        location.replace(target + search + hash);
      } catch (e) {
        location.replace(${JSON.stringify(target)});
      }
    })();
  </script>
</body>
</html>`;
}

// Write only if content changes
function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) {
      return false; // no change
    }
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return true;
}

// Generate pages for visible cities
let changes = 0;
const visibleEntries = Object.entries(CITY_CONFIG).filter(([, cfg]) => cfg && cfg.visible !== false);

const reservedKeys = new Set(Object.keys(CITY_CONFIG));
const aliasRedirects = new Map();
visibleEntries.forEach(([cityKey, cfg]) => {
  if (!cfg || !Array.isArray(cfg.aliases)) return;
  cfg.aliases.forEach(rawAlias => {
    const alias = String(rawAlias || '').trim().toLowerCase();
    if (!alias || alias === cityKey) return;
    if (reservedKeys.has(alias)) {
      console.log(`Skipping alias "${alias}" for ${cityKey} (conflicts with city key).`);
      return;
    }
    if (aliasRedirects.has(alias)) {
      const existing = aliasRedirects.get(alias);
      console.log(`Skipping alias "${alias}" for ${cityKey} (already mapped to ${existing.cityKey}).`);
      return;
    }
    aliasRedirects.set(alias, { cityKey, cfg });
  });
});

const aliasEntries = Array.from(aliasRedirects.entries()).sort(([a], [b]) => a.localeCompare(b));

visibleEntries.forEach(([cityKey, cfg]) => {
  const outDir = path.join(ROOT, cityKey);
  const outFile = path.join(outDir, 'index.html');
  const cityHtml = buildCityHtml(templateHtml, cityKey, cfg);
  const wrote = writeIfChanged(outFile, cityHtml);
  if (wrote) {
    changes++;
    console.log(`✓ Wrote ${path.relative(ROOT, outFile)}`);
  } else {
    console.log(`⏭️  No change for ${path.relative(ROOT, outFile)}`);
  }
});

{
  const outFile = path.join(ROOT, BEAR_RUNS_KEY, 'index.html');
  const wrote = writeIfChanged(outFile, buildBearRunsHtml(templateHtml));
  if (wrote) {
    changes++;
    console.log(`✓ Wrote ${path.relative(ROOT, outFile)}`);
  } else {
    console.log(`⏭️  No change for ${path.relative(ROOT, outFile)}`);
  }
}

aliasEntries.forEach(([alias, { cityKey, cfg }]) => {
  const outDir = path.join(ROOT, alias);
  const outFile = path.join(outDir, 'index.html');
  const aliasHtml = buildAliasRedirectHtml(cityKey, cfg);
  const wrote = writeIfChanged(outFile, aliasHtml);
  if (wrote) {
    changes++;
    console.log(`Wrote alias redirect ${alias} -> ${cityKey}`);
  } else {
    console.log(`No change for alias redirect ${alias} -> ${cityKey}`);
  }
});

const validDirectories = new Set([
  ...visibleEntries.map(([key]) => key),
  ...aliasEntries.map(([alias]) => alias),
  BEAR_RUNS_KEY
]);

// Optional pruning of removed cities/aliases: only delete directories containing markers
function pruneRemovedCities(valid) {
  const entries = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory());
  let removed = 0;
  entries.forEach(dirent => {
    const name = dirent.name;
    if (!valid.has(name)) {
      const candidate = path.join(ROOT, name, 'index.html');
      if (fs.existsSync(candidate)) {
        const html = fs.readFileSync(candidate, 'utf8');
        if (html.includes(CITY_MARKER) || html.includes(ALIAS_MARKER)) {
          fs.rmSync(path.join(ROOT, name), { recursive: true, force: true });
          removed++;
          console.log(`🗑️  Removed generated directory: ${name}`);
        }
      }
    }
  });
  return removed;
}

const removedCount = pruneRemovedCities(validDirectories);
if (removedCount > 0) changes += removedCount;

if (changes === 0) {
  console.log('No city pages changed.');
} else {
  console.log(`City generation complete. ${changes} change(s).`);
}


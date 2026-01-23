#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve project root relative to this script
const ROOT = path.resolve(__dirname, '..');

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
  // Get all available cities for the dropdown
  const availableCities = Object.entries(CITY_CONFIG)
    .filter(([, cfg]) => cfg && cfg.visible !== false)
    .map(([key, cfg]) => ({ key, ...cfg }));

  // Build city dropdown options HTML with direct links
  const cityOptions = availableCities.map(city => `
                            <a href="../${city.key}/" class="city-option">
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

  // Basic OpenGraph tags with ICS-hash-based version for cache-busting when data changes
  const ogTags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${cityTitle}">`,
    `<meta property="og:description" content="${cityDesc}">`,
    `<meta property="og:url" content="https://chunky.dad${canonicalHref}">`,
    `<meta property="og:image" content="https://chunky.dad/Rising_Star_Ryan_Head_Compressed.png${ogVersion ? `?v=${ogVersion}` : ''}">`
  ].join('\n  ');

  if (!html.includes('property="og:title"')) {
    html = html.replace('</head>', `  ${ogTags}\n</head>`);
  } else {
    html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${cityTitle}">`)
               .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${cityDesc}">`)
               .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="https:\/\/chunky.dad${canonicalHref}">`);
    if (html.includes('property="og:image"')) {
      html = html.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="https://chunky.dad/Rising_Star_Ryan_Head_Compressed.png${ogVersion ? `?v=${ogVersion}` : ''}">`);
    } else {
      html = html.replace('</head>', `  <meta property="og:image" content="https://chunky.dad/Rising_Star_Ryan_Head_Compressed.png${ogVersion ? `?v=${ogVersion}` : ''}">\n</head>`);
    }
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
  ...aliasEntries.map(([alias]) => alias)
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


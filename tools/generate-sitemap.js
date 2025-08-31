#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

// Base URL for the sitemap
const BASE_URL = 'https://chunky.dad';

// Get current date in W3C format for lastmod
const getCurrentDate = () => {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD format
};

// Priority values for different page types
const PRIORITIES = {
  home: '1.0',
  city: '0.9',
  bearDirectory: '0.8',
  static: '0.5'
};

// Change frequencies
const CHANGE_FREQ = {
  home: 'weekly',
  city: 'weekly',
  bearDirectory: 'monthly',
  static: 'monthly'
};

// Build the sitemap XML
function buildSitemap() {
  const lastmod = getCurrentDate();
  const urls = [];

  // Add home page
  urls.push({
    loc: BASE_URL + '/',
    lastmod: lastmod,
    changefreq: CHANGE_FREQ.home,
    priority: PRIORITIES.home
  });

  // Add all visible city pages
  const visibleCities = Object.entries(CITY_CONFIG)
    .filter(([, cfg]) => cfg && cfg.visible !== false)
    .sort(([a], [b]) => a.localeCompare(b)); // Sort alphabetically for consistency

  visibleCities.forEach(([cityKey, cfg]) => {
    urls.push({
      loc: `${BASE_URL}/${cityKey}/`,
      lastmod: lastmod,
      changefreq: CHANGE_FREQ.city,
      priority: PRIORITIES.city
    });
  });

  // Add bear directory page if it exists
  const bearDirectoryPath = path.join(ROOT, 'bear-directory.html');
  if (fs.existsSync(bearDirectoryPath)) {
    urls.push({
      loc: `${BASE_URL}/bear-directory.html`,
      lastmod: lastmod,
      changefreq: CHANGE_FREQ.bearDirectory,
      priority: PRIORITIES.bearDirectory
    });
  }

  // Build XML content
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  urls.forEach(url => {
    xml += '  <url>\n';
    xml += `    <loc>${url.loc}</loc>\n`;
    xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
    xml += `    <priority>${url.priority}</priority>\n`;
    xml += '  </url>\n';
  });

  xml += '</urlset>\n';

  return { xml, urlCount: urls.length };
}

// Write only if content changes
function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) {
      return false; // no change
    }
  }
  fs.writeFileSync(filePath, content);
  return true;
}

// Main execution
function main() {
  console.log('Generating sitemap.xml...');
  
  const { xml, urlCount } = buildSitemap();
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  
  const changed = writeIfChanged(sitemapPath, xml);
  
  if (changed) {
    console.log(`✓ Generated sitemap.xml with ${urlCount} URLs`);
    console.log(`  - Homepage`);
    console.log(`  - ${Object.keys(CITY_CONFIG).filter(k => CITY_CONFIG[k].visible !== false).length} city pages`);
    if (fs.existsSync(path.join(ROOT, 'bear-directory.html'))) {
      console.log(`  - Bear directory`);
    }
  } else {
    console.log(`⏭️  No changes to sitemap.xml (${urlCount} URLs)`);
  }
  
  return changed ? 1 : 0;
}

// Run the generator
const changes = main();
process.exit(0);
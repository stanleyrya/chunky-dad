#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Import shared filename utilities
const { generateFilenameFromUrl, generateFaviconFilename, generateEventFilename, cleanImageUrl, getEventDirectoryPath, convertImageUrlToLocalPath, detectFileExtension, isLinktreeUrl, isWikipediaUrl, generateLinktreeFaviconFilename, generateWikipediaFaviconFilename, isImageUrl } = require('../js/filename-utils.js');

/**
 * Adjust Eventbrite image URLs to get uncropped versions
 * Converts img.evbuc.com URLs to cdn.evbuc.com uncropped versions
 * @param {string} imageUrl - The original image URL
 * @returns {string} - The adjusted URL or original if not an Eventbrite URL
 */
function adjustEventbriteImageUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return imageUrl;
  }

  // Check if this is an Eventbrite img.evbuc.com URL
  if (!imageUrl.includes('img.evbuc.com')) {
    return imageUrl;
  }

  try {
    // Extract the inner URL from the img.evbuc.com wrapper
    // Example: https://img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2Fimages%2F1107233553%2F2544065821071%2F1%2Foriginal.20250828-015122?crop=...
    // Should become: https://cdn.evbuc.com/images/1107233553/2544065821071/1/original.20250828-015122
    
    const url = new URL(imageUrl);
    const pathname = url.pathname;
    
    // The pathname should contain the encoded inner URL
    // Remove the leading slash and decode the URL
    const encodedInnerUrl = pathname.substring(1);
    const innerUrl = decodeURIComponent(encodedInnerUrl);
    
    // Check if the inner URL is a cdn.evbuc.com URL
    if (innerUrl.includes('cdn.evbuc.com')) {
      // Remove any query parameters to get the uncropped version
      const innerUrlObj = new URL(innerUrl);
      const uncroppedUrl = `${innerUrlObj.protocol}//${innerUrlObj.host}${innerUrlObj.pathname}`;
      console.log(`🎫 Eventbrite: Adjusted image URL from cropped to uncropped: ${imageUrl} -> ${uncroppedUrl}`);
      return uncroppedUrl;
    }
  } catch (error) {
    console.warn(`🎫 Eventbrite: Failed to adjust image URL: ${error.message}`);
  }

  // Return original URL if adjustment fails
  return imageUrl;
}


// Mock logger for Node.js environment
global.logger = {
  componentInit: (component, message, data) => console.log(`[${component}] ${message}`, data || ''),
  componentLoad: (component, message, data) => console.log(`[${component}] ${message}`, data || ''),
  componentError: (component, message, data) => console.error(`[${component}] ERROR: ${message}`, data || ''),
  info: (component, message, data) => console.log(`[${component}] ${message}`, data || ''),
  debug: (component, message, data) => console.log(`[${component}] DEBUG: ${message}`, data || ''),
  warn: (component, message, data) => console.warn(`[${component}] WARN: ${message}`, data || ''),
  error: (component, message, data) => console.error(`[${component}] ERROR: ${message}`, data || ''),
  time: (component, label) => console.time(`[${component}] ${label}`),
  timeEnd: (component, label) => console.timeEnd(`[${component}] ${label}`),
  apiCall: (component, message, data) => console.log(`[${component}] API: ${message}`, data || '')
};

// Import calendar core for parsing
require('../js/event-schema.js');
const CalendarCore = require('../js/calendar-core.js');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'img');
const FAVICONS_DIR = path.join(IMAGES_DIR, 'favicons');
const EVENTS_DIR = path.join(IMAGES_DIR, 'events');

// Favicon cache duration: 90 days in milliseconds.
// Only favicons use this TTL — event image URLs are content-fingerprinted by their CDNs
// (Wix, Eventbrite, etc.) and local filenames are derived from the URL, so an existing
// event image never goes stale: a changed image arrives under a new URL/filename.
const CACHE_DURATION = 90 * 24 * 60 * 60 * 1000;

// Randomization factor: ±7 days to prevent all favicons from expiring simultaneously
// (scaled up from ±2 days to stay proportional to the 90-day TTL)
const CACHE_RANDOMIZATION = 7 * 24 * 60 * 60 * 1000;

// Dry-run mode: log download decisions without downloading or writing any files
const DRY_RUN = process.argv.includes('--dry-run');

// ---------------------------------------------------------------------------
// Favicon fallback ladder + negative cache
//
// Google's s2 favicon service 404s on larger sizes for small sites, and those
// 404s repeated on every run forever. When a requested size fails we walk a
// fallback ladder (smaller s2 sizes, the site's own /favicon.ico, DuckDuckGo's
// icon service). Only when the ENTIRE ladder fails does the domain enter a
// persistent negative cache (data/favicon-misses.json) that suppresses retries
// for 7 days.
// ---------------------------------------------------------------------------

const FAVICON_MISS_CACHE_PATH = path.join(ROOT, 'data', 'favicon-misses.json');

// Retry a known-miss domain once its lastTried is at least this old
const FAVICON_MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

// Sizes Google's s2 service supports, largest first
const GOOGLE_S2_FALLBACK_SIZES = [256, 128, 64, 32, 16];

// Extract the target domain from a Google s2 favicon URL, or null when the URL
// is not a Google s2 favicon request.
function getGoogleFaviconDomain(faviconUrl) {
  try {
    const parsed = new URL(faviconUrl);
    if (parsed.hostname === 'www.google.com' && parsed.pathname === '/s2/favicons') {
      return parsed.searchParams.get('domain') || null;
    }
  } catch (e) {
    // Not a parseable URL — not a Google s2 request
  }
  return null;
}

// Build the ordered fallback ladder for a domain whose preferred s2 size failed:
// progressively smaller Google s2 sizes (below the requested size), then the
// site's own /favicon.ico, then DuckDuckGo's keyless icon service.
function buildFaviconFallbackLadder(domain, requestedSize) {
  const requested = parseInt(requestedSize, 10);
  const rungs = [];
  for (const sz of GOOGLE_S2_FALLBACK_SIZES) {
    if (Number.isFinite(requested) && sz < requested) {
      rungs.push({
        rung: `google-s2-${sz}px`,
        url: `https://www.google.com/s2/favicons?domain=${domain}&sz=${sz}`
      });
    }
  }
  rungs.push({ rung: 'site-favicon.ico', url: `https://${domain}/favicon.ico` });
  rungs.push({ rung: 'duckduckgo', url: `https://icons.duckduckgo.com/ip3/${domain}.ico` });
  return rungs;
}

// True when a negative-cache entry is fresh enough that the domain should be
// skipped entirely (lastTried younger than the 7-day retry window).
function shouldSkipKnownMiss(entry, nowMs) {
  if (!entry || typeof entry !== 'object') return false;
  const lastTried = Date.parse(entry.lastTried);
  if (!Number.isFinite(lastTried)) return false;
  return (nowMs - lastTried) < FAVICON_MISS_RETRY_MS;
}

// Record that a domain's entire fallback ladder failed. Mutates the cache.
function recordFaviconMiss(cache, domain, nowIso) {
  const existing = (cache[domain] && typeof cache[domain] === 'object') ? cache[domain] : null;
  cache[domain] = {
    misses: ((existing && Number.isFinite(existing.misses)) ? existing.misses : 0) + 1,
    firstMiss: (existing && existing.firstMiss) || nowIso,
    lastTried: nowIso
  };
  return cache[domain];
}

// Load the negative cache; corrupt or absent file starts fresh, never throws.
function loadFaviconMissCache(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {
    // Absent or corrupt — start fresh
  }
  return {};
}

// Persist the negative cache (sorted keys for stable diffs). Skips creating an
// empty file when there is nothing to record and no file exists yet.
function saveFaviconMissCache(filePath, cache) {
  try {
    const domains = Object.keys(cache);
    if (domains.length === 0 && !fs.existsSync(filePath)) return;
    const sorted = {};
    for (const domain of domains.sort()) {
      sorted[domain] = cache[domain];
    }
    writeMetadataIfChanged(filePath, sorted);
  } catch (e) {
    console.warn(`⚠️  Could not save favicon miss cache ${filePath}:`, e.message);
  }
}

// Validate that a response is actually an image: image/* content-type, or known
// magic bytes (PNG, JPEG, GIF, ICO, BMP, WEBP) in the first bytes of the body.
function looksLikeImage(contentType, headerBytes) {
  if (contentType && /^image\//i.test(String(contentType).trim())) return true;
  if (!headerBytes || headerBytes.length < 4) return false;
  const b = headerBytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPEG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true; // GIF
  if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return true; // ICO/CUR
  if (b[0] === 0x42 && b[1] === 0x4d) return true; // BMP
  if (b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WEBP
  return false;
}

// Download one fallback rung into localPath and verify it is a real image.
// Throws (after deleting the file) when the response is not an image.
async function attemptFaviconRungDownload(rungUrl, localPath) {
  const downloadResult = await downloadFile(rungUrl, localPath, 15000, 5, null, { quiet: true });
  let size = 0;
  let headerBytes = null;
  try {
    size = fs.statSync(localPath).size;
    const fd = fs.openSync(localPath, 'r');
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    headerBytes = buf.subarray(0, bytesRead);
  } catch (e) {
    // Fall through to validation failure below
  }
  if (size === 0 || !looksLikeImage(downloadResult.contentType, headerBytes)) {
    try { fs.unlinkSync(localPath); } catch (e) { /* already gone */ }
    throw new Error(`Not an image (content-type: ${downloadResult.contentType || 'unknown'})`);
  }
  return downloadResult;
}

// Download a Google s2 favicon with the fallback ladder and negative cache.
// Non-s2 URLs pass straight through to downloadImageWithSize.
// The fallback result is stored under the REQUESTED size's filename slot
// (favicon-<domain>-<size>px.ico): consumers derive paths purely from
// domain + requested size (convertWebsiteUrlToFaviconPath), never from actual
// pixel dimensions, so the slot name is the only place they will look.
async function downloadFaviconWithFallback(imageUrl, size, missCache, stats) {
  const domain = getGoogleFaviconDomain(imageUrl);
  if (!domain) {
    return downloadImageWithSize(imageUrl, 'favicon', size);
  }

  // Negative cache: skip domains whose entire ladder failed less than 7d ago
  if (shouldSkipKnownMiss(missCache[domain], Date.now())) {
    return { success: true, skipped: true, knownMiss: true, filename: null, reason: 'Known miss (negative cache, retry after 7d)' };
  }

  // Primary attempt at the requested size (quiet: the ladder logs one line per
  // domain on final failure instead of one line per attempt)
  const primary = await downloadImageWithSize(imageUrl, 'favicon', size, { quiet: true });
  if (primary.success) {
    if (!primary.dryRun && missCache[domain]) {
      delete missCache[domain];
    }
    return primary;
  }

  // Primary failed — walk the fallback ladder, storing under the requested slot
  const filename = generateFilename(imageUrl, 'favicon', size);
  const localPath = path.join(FAVICONS_DIR, filename);
  const metadataPath = localPath + '.meta';
  ensureDir(FAVICONS_DIR);

  const ladder = buildFaviconFallbackLadder(domain, size);
  for (const rung of ladder) {
    try {
      const downloadResult = await attemptFaviconRungDownload(rung.url, localPath);
      const metadata = {
        originalUrl: imageUrl,
        type: 'favicon',
        filename: filename,
        size: size,
        contentType: downloadResult.contentType,
        contentLength: downloadResult.contentLength,
        fallbackRung: rung.rung,
        fallbackUrl: rung.url
      };
      applyDownloadStamp(metadata, downloadResult);
      writeMetadataIfChanged(metadataPath, metadata);
      delete missCache[domain];
      if (stats) stats.fromFallbacks++;
      console.log(`✅ Downloaded favicon image via fallback (${rung.rung}): ${filename}`);
      return { success: true, skipped: false, filename, localPath, fallbackRung: rung.rung };
    } catch (e) {
      // Try the next rung
    }
  }

  // Entire ladder failed — record the miss; one log line per domain
  recordFaviconMiss(missCache, domain, new Date().toISOString());
  console.error(`❌ Favicon unavailable for ${domain}: ${size}px request and all ${ladder.length} fallbacks failed`);
  return { success: false, error: 'Favicon fallback ladder exhausted', url: imageUrl, domain };
}

// Ensure directories exist
// Helper to read existing failure count, increment it, and write metadata
function saveFailureMetadata(metadataPathFallback, failureMetadata) {
  let failureCount = 0;
  if (fs.existsSync(metadataPathFallback)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(metadataPathFallback, 'utf8'));
      if (existingData.failureCount) {
        failureCount = existingData.failureCount;
      } else if (existingData.failedAt) {
        // Migration for old format without failureCount
        failureCount = 1;
      }
    } catch (e) {
      console.warn(`⚠️  Could not read existing failure metadata for ${metadataPathFallback}:`, e.message);
    }
  }

  failureMetadata.failureCount = failureCount + 1;
  fs.writeFileSync(metadataPathFallback, JSON.stringify(failureMetadata, null, 2));
}

// Write metadata only when its serialized content actually changed.
// Rewriting identical .meta files resets mtimes and creates needless git churn.
function writeMetadataIfChanged(metadataPath, metadata) {
  const serialized = JSON.stringify(metadata, null, 2);
  if (fs.existsSync(metadataPath)) {
    try {
      const existing = fs.readFileSync(metadataPath, 'utf8');
      if (existing === serialized) {
        return false;
      }
    } catch (e) {
      // Unreadable existing metadata — fall through and rewrite it
    }
  }
  fs.writeFileSync(metadataPath, serialized);
  return true;
}

// After an HTTP 304 (Not Modified), record when we last verified the favicon with the
// server — WITHOUT touching the image file itself (no image rewrite, no git churn).
// lastCheckedAt is stored at day precision so repeated 304s within the same day
// don't rewrite the .meta file either.
function touchMetadataCheckedAt(metadataPath) {
  let metadata = {};
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch (e) {
      console.warn(`⚠️  Could not read metadata for revalidation touch ${metadataPath}:`, e.message);
    }
  }
  metadata.lastCheckedAt = new Date().toISOString().slice(0, 10); // day precision (YYYY-MM-DD)
  return writeMetadataIfChanged(metadataPath, metadata);
}

// Extract stored HTTP validators (ETag / Last-Modified) from metadata, if any
function getStoredValidators(metadata) {
  if (!metadata) return null;
  if (!metadata.etag && !metadata.lastModified) return null;
  return { etag: metadata.etag, lastModified: metadata.lastModified };
}

// Stamp download time and any HTTP cache validators onto metadata so favicons can be
// revalidated with conditional requests instead of full re-downloads later
function applyDownloadStamp(metadata, downloadResult) {
  metadata.downloadedAt = new Date().toISOString();
  if (downloadResult.etag) {
    metadata.etag = downloadResult.etag;
  }
  if (downloadResult.lastModified) {
    metadata.lastModified = downloadResult.lastModified;
  }
  return metadata;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Download event image with event information
async function downloadEventImage(imageUrl, eventInfo) {
  try {
    // Adjust Eventbrite image URLs to get uncropped versions
    const adjustedUrl = adjustEventbriteImageUrl(imageUrl);
    
    // Get the directory structure based on event type using shared utility
    const dirPath = getEventDirectoryPath(eventInfo, 'img/events');
    const dir = path.join(ROOT, dirPath);
    
    // Ensure directory exists
    ensureDir(dir);
    
    // First, try to detect the file extension from URL
    const detectedExtension = detectFileExtension(adjustedUrl);
    
    // Generate filename with detected extension using adjusted URL for consistent hashing
    const filename = generateEventFilename(adjustedUrl, eventInfo, detectedExtension);
    const localPath = path.join(dir, filename);
    const metadataPath = localPath + '.meta';
    
    // Check if we should download
    const { shouldDownload, reason } = shouldDownloadImage(imageUrl, localPath, metadataPath, 'event');

    if (!shouldDownload) {
      console.log(`⏭️  Skipping event image: ${filename} (${reason})`);
      return { success: true, skipped: true, filename, reason };
    }

    if (DRY_RUN) {
      console.log(`🔎 [dry-run] Would download event image: ${filename} (${reason})`);
      return { success: true, skipped: true, dryRun: true, filename, reason };
    }

    console.log(`📥 Downloading event image: ${filename} (${reason})`);
    console.log(`   Event: ${eventInfo.name}`);
    console.log(`   Type: ${eventInfo.recurring ? 'recurring' : 'one-time'}`);
    console.log(`   Path: ${path.relative(ROOT, localPath)}`);
    console.log(`   Original URL: ${imageUrl}`);
    console.log(`   Adjusted URL: ${adjustedUrl}`);
    console.log(`   Detected extension: ${detectedExtension}`);
    
    // Download the image and get content type
    const downloadResult = await downloadFile(adjustedUrl, localPath);
    
    // If we got a different content type, regenerate filename with correct extension
    if (downloadResult.contentType) {
      const actualExtension = detectFileExtension(adjustedUrl, downloadResult.contentType);
      if (actualExtension !== detectedExtension) {
        console.log(`🔄 Content type detected different extension: ${actualExtension} (was ${detectedExtension})`);
          // Generate new filename with correct extension
        const correctFilename = generateEventFilename(adjustedUrl, eventInfo, actualExtension);
        const correctPath = path.join(dir, correctFilename);
        const correctMetadataPath = correctPath + '.meta';
          // Move the file to the correct name
        if (fs.existsSync(localPath)) {
          fs.renameSync(localPath, correctPath);
          if (fs.existsSync(metadataPath)) {
            fs.renameSync(metadataPath, correctMetadataPath);
          }
        }
          // Update variables to use correct paths
        const finalFilename = correctFilename;
        const finalPath = correctPath;
        const finalMetadataPath = correctMetadataPath;
          // Save metadata with event information
        const metadata = {
          originalUrl: imageUrl,
          adjustedUrl: adjustedUrl,
          type: 'event',
          filename: finalFilename,
          contentType: downloadResult.contentType,
          contentLength: downloadResult.contentLength,
          eventInfo: {
            name: eventInfo.name,
            startDate: eventInfo.startDate,
            recurring: eventInfo.recurring
          }
        };
          applyDownloadStamp(metadata, downloadResult);
          writeMetadataIfChanged(finalMetadataPath, metadata);
          console.log(`✅ Downloaded event image: ${finalFilename} (${actualExtension})`);
        return { success: true, skipped: false, filename: finalFilename, localPath: finalPath };
      }
    }
    
    // Save metadata with event information
    const metadata = {
      originalUrl: imageUrl,
      adjustedUrl: adjustedUrl,
      type: 'event',
      filename: filename,
      contentType: downloadResult.contentType,
      contentLength: downloadResult.contentLength,
      eventInfo: {
        name: eventInfo.name,
        startDate: eventInfo.startDate,
        recurring: eventInfo.recurring
      }
    };

    applyDownloadStamp(metadata, downloadResult);
    writeMetadataIfChanged(metadataPath, metadata);

    console.log(`✅ Downloaded event image: ${filename} (${detectedExtension})`);
    return { success: true, skipped: false, filename, localPath };
    
  } catch (error) {
    console.error(`❌ Failed to download event image from ${imageUrl}:`, error.message);

    // Save failure metadata for backoff
    try {
      const failureMetadata = {
        originalUrl: imageUrl,
        error: error.message,
        type: 'event'
      };
      // We assume localPath and metadataPath were constructed prior to the try block (or inside it if scope permits)
      // Since localPath and metadataPath are inside the try block, we need to regenerate them here
      const adjustedUrl = adjustEventbriteImageUrl(imageUrl);
      const dirPath = getEventDirectoryPath(eventInfo, 'img/events');
      const dir = path.join(ROOT, dirPath);
      const detectedExtension = detectFileExtension(adjustedUrl);
      const filename = generateEventFilename(adjustedUrl, eventInfo, detectedExtension);
      const metadataPathFallback = path.join(dir, filename) + '.meta';
      ensureDir(dir);
      saveFailureMetadata(metadataPathFallback, failureMetadata);
    } catch (metaError) {
      console.error(`❌ Failed to write failure metadata for event image ${imageUrl}:`, metaError.message);
    }

    return { success: false, error: error.message, url: imageUrl };
  }
}

// Extract profile picture URL from Linktree page
async function extractLinktreeProfilePicture(linktreeUrl) {
  try {
    console.log(`🔍 Extracting profile picture from Linktree: ${linktreeUrl}`);
    
    // Fetch the Linktree page HTML
    const html = await fetchPageContent(linktreeUrl);
    
    // Use regex to find the profile picture URL to avoid JSDOM CSS parsing errors
    let profilePictureUrl = null;
    const jsonMatch = html.match(/"profilePictureUrl":"([^"]+)"/);
    if (jsonMatch && jsonMatch[1]) {
      profilePictureUrl = jsonMatch[1];
    } else {
      const metaMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
      if (metaMatch && metaMatch[1]) {
        profilePictureUrl = metaMatch[1];
      }
    }
    if (!profilePictureUrl) {
      console.log('⚠️  No profile picture image found in HTML');
      return null;
    }
    console.log(`✅ Found profile picture URL: ${profilePictureUrl}`);
    
    return profilePictureUrl;
    
  } catch (error) {
    console.error(`❌ Failed to extract profile picture from Linktree:`, error.message);
    return null;
  }
}

// Extract logo image URL from Wikipedia page
async function extractWikipediaLogo(wikipediaUrl) {
  console.log(`🔍 Extracting logo from Wikipedia: ${wikipediaUrl}`);
  
  const html = await fetchPageContent(wikipediaUrl);
  const match = html.match(/<td[^>]*class="[^"]*infobox-image[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i);
  if (!match || !match[1]) {
    throw new Error('No logo found in Wikipedia infobox');
  }
  let logoUrl = match[1];
  if (logoUrl.startsWith('//')) {
    logoUrl = 'https:' + logoUrl;
  } else if (logoUrl.startsWith('/')) {
    const parsedUrl = new URL(wikipediaUrl);
    logoUrl = parsedUrl.protocol + '//' + parsedUrl.hostname + logoUrl;
  }
  
  console.log(`✅ Found Wikipedia logo URL: ${logoUrl}`);
  return logoUrl;
}

// Fetch page content with proper headers
async function fetchPageContent(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const zlib = require('zlib');
    
    const request = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; chunky.dad-image-downloader/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    }, (response) => {
      let stream = response;
      // Handle gzip/deflate decompression
      if (response.headers['content-encoding'] === 'gzip') {
        stream = response.pipe(zlib.createGunzip());
      } else if (response.headers['content-encoding'] === 'deflate') {
        stream = response.pipe(zlib.createInflate());
      }
      let data = '';
      stream.on('data', (chunk) => {
        data += chunk;
      });
      stream.on('end', () => {
        resolve(data);
      });
      stream.on('error', (err) => {
        reject(err);
      });
    });
    
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Process and optimize image for specific size
async function processProfilePicture(inputPath, outputPath, targetSize = 96) {
  try {
    const sharp = require('sharp');
    
    // Get image metadata
    const metadata = await sharp(inputPath).metadata();
    console.log(`📏 Original image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);
    
    // Process the image: resize to target size, maintain aspect ratio, optimize
    await sharp(inputPath)
      .resize(targetSize, targetSize, {
        fit: 'cover',
        position: 'center'
      })
      .png({
        quality: 90,
        compressionLevel: 6,
        progressive: true
      })
      .toFile(outputPath);
    
    // Get optimized image metadata
    const optimizedMetadata = await sharp(outputPath).metadata();
    const inputSize = fs.statSync(inputPath).size;
    const outputSize = fs.statSync(outputPath).size;
    const compressionRatio = ((inputSize - outputSize) / inputSize * 100).toFixed(1);
    
    console.log(`✅ Processed profile picture: ${outputPath}`);
    console.log(`📏 Optimized image: ${optimizedMetadata.width}x${optimizedMetadata.height}`);
    console.log(`📦 Size reduction: ${inputSize} bytes → ${outputSize} bytes (${compressionRatio}% smaller)`);
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to process profile picture:`, error.message);
    // Fallback to simple copy if sharp fails
    try {
      fs.copyFileSync(inputPath, outputPath);
      console.log(`⚠️  Fallback: copied original image to ${outputPath}`);
      return true;
    } catch (copyError) {
      console.error(`❌ Fallback copy also failed:`, copyError.message);
      return false;
    }
  }
}

// Download file with timeout, redirect handling and optional HTTP conditional revalidation.
// Pass `validators` ({ etag, lastModified }) to send If-None-Match / If-Modified-Since;
// when the server answers 304 Not Modified the promise resolves with { notModified: true }
// and the existing file on disk is left untouched.
function downloadFile(url, outputPath, timeout = 30000, maxRedirects = 5, validators = null, options = {}) {
  return new Promise((resolve, reject) => {
    const downloadWithRedirects = (currentUrl, redirectCount = 0) => {
      if (redirectCount > maxRedirects) {
        reject(new Error(`Too many redirects (max: ${maxRedirects})`));
        return;
      }
      const parsedUrl = new URL(currentUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; chunky.dad-image-downloader/1.0)',
        'Accept': 'image/*,*/*;q=0.8'
      };
      if (validators) {
        if (validators.etag) {
          headers['If-None-Match'] = validators.etag;
        }
        if (validators.lastModified) {
          headers['If-Modified-Since'] = validators.lastModified;
        }
      }
      const request = client.get(currentUrl, {
        timeout: timeout,
        headers: headers
      }, (response) => {
        // Handle 304 Not Modified from conditional revalidation — keep the existing file
        if (response.statusCode === 304) {
          response.resume(); // Drain the (empty) response
          resolve({ notModified: true });
          return;
        }
        // Handle redirects (301, 302, 303, 307, 308)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = new URL(response.headers.location, currentUrl).href;
          if (!options.quiet) {
            console.log(`🔄 Following redirect ${redirectCount + 1}/${maxRedirects}: ${currentUrl} -> ${redirectUrl}`);
          }
          downloadWithRedirects(redirectUrl, redirectCount + 1);
          return;
        }
          if (response.statusCode >= 200 && response.statusCode < 300) {
          const fileStream = fs.createWriteStream(outputPath);
          response.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            // Return content type information plus cache validators for revalidation
            resolve({
              contentType: response.headers['content-type'],
              contentLength: response.headers['content-length'],
              etag: response.headers['etag'],
              lastModified: response.headers['last-modified']
            });
          });
          fileStream.on('error', (err) => {
            fs.unlink(outputPath, () => {}); // Delete partial file
            reject(err);
          });
        } else {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        }
      });
      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    };

    downloadWithRedirects(url);
  });
}

// Generate filename from URL using shared utility
function generateFilename(url, type = 'event', size = null) {
    if (type === 'favicon') {
        const baseFilename = generateFaviconFilename(url);
        if (size) {
            // Check if filename already contains a size suffix to avoid double suffixes
            const ext = path.extname(baseFilename);
            const nameWithoutExt = path.basename(baseFilename, ext);
              // If the filename already contains a size suffix (like -64px), don't add another one
            if (nameWithoutExt.includes('-64px') || nameWithoutExt.includes('-32px') || nameWithoutExt.includes('-256px')) {
                return baseFilename;
            }
              // Add size suffix for higher quality favicons
            return `${nameWithoutExt}-${size}px${ext}`;
        }
        return baseFilename;
    }
    return generateFilenameFromUrl(url);
}

// Download image with a custom filename
async function downloadImageWithCustomFilename(imageUrl, customFilename, type = 'event', isLinktreeProfile = false, targetSize = 96) {
  try {
    const dir = type === 'favicon' ? FAVICONS_DIR : EVENTS_DIR;
    const localPath = path.join(dir, customFilename);
    const metadataPath = localPath + '.meta';
    
    // Check if we should download
    const { shouldDownload, reason, revalidation } = shouldDownloadImage(imageUrl, localPath, metadataPath, type);

    if (!shouldDownload) {
      console.log(`⏭️  Skipping ${type} image: ${customFilename} (${reason})`);
      return { success: true, skipped: true, filename: customFilename, reason };
    }

    if (DRY_RUN) {
      console.log(`🔎 [dry-run] Would download ${type} image: ${customFilename} (${reason})`);
      return { success: true, skipped: true, dryRun: true, filename: customFilename, reason };
    }

    console.log(`📥 Downloading ${type} image: ${customFilename} (${reason})`);
    console.log(`   URL: ${imageUrl}`);

    // Download the image (conditionally, when we have stored validators)
    const downloadResult = await downloadFile(imageUrl, localPath, 30000, 5, revalidation);

    // Server confirmed our cached copy is still current — record the check, keep the file
    if (downloadResult.notModified) {
      touchMetadataCheckedAt(metadataPath);
      console.log(`✅ Revalidated ${type} image (HTTP 304, not modified): ${customFilename}`);
      return { success: true, skipped: true, notModified: true, filename: customFilename, reason: 'Not modified (HTTP 304)' };
    }

    // Process Linktree profile pictures with optimization
    if (isLinktreeProfile && type === 'favicon') {
      const tempPath = localPath + '.temp';
      const optimizedPath = localPath + '.optimized';
      try {
        // Move original to temp location
        fs.renameSync(localPath, tempPath);
        // Process and optimize the image
        const processed = await processProfilePicture(tempPath, optimizedPath, targetSize);
        if (processed) {
          // Replace original with optimized version
          fs.renameSync(optimizedPath, localPath);
          console.log(`🎨 Applied optimization to Linktree profile picture`);
        } else {
          // Fallback: restore original if processing failed
          fs.renameSync(tempPath, localPath);
        }
        // Clean up temp file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        if (fs.existsSync(optimizedPath)) {
          fs.unlinkSync(optimizedPath);
        }
      } catch (processError) {
        console.warn(`⚠️  Image processing failed, using original: ${processError.message}`);
        // Restore original if it was moved
        if (fs.existsSync(tempPath) && !fs.existsSync(localPath)) {
          fs.renameSync(tempPath, localPath);
        }
      }
    }
    
    // Save metadata
    const metadata = {
      originalUrl: imageUrl,
      type: type,
      filename: customFilename,
      contentType: downloadResult.contentType,
      contentLength: downloadResult.contentLength,
      isLinktreeProfile: isLinktreeProfile
    };

    applyDownloadStamp(metadata, downloadResult);
    writeMetadataIfChanged(metadataPath, metadata);

    console.log(`✅ Downloaded ${type} image: ${customFilename}`);
    return { success: true, skipped: false, filename: customFilename, localPath };
    
  } catch (error) {
    console.error(`❌ Failed to download ${type} image from ${imageUrl}:`, error.message);

    try {
      const dir = type === 'favicon' ? FAVICONS_DIR : EVENTS_DIR;
      const metadataPathFallback = path.join(dir, customFilename) + '.meta';
      ensureDir(dir);
      const failureMetadata = {
        originalUrl: imageUrl,
        error: error.message,
        type: type,
        filename: customFilename
      };
      saveFailureMetadata(metadataPathFallback, failureMetadata);
    } catch (metaError) {
      console.error(`❌ Failed to write failure metadata for ${type} image ${imageUrl}:`, metaError.message);
    }

    return { success: false, error: error.message, url: imageUrl };
  }
}

// Check if we should download the image
// - Event images: URLs are content-fingerprinted by their CDNs (Wix, Eventbrite, etc.) and
//   local filenames are derived from the URL, so same URL -> same bytes. An existing
//   non-empty file is cached indefinitely; a changed image arrives under a new URL and
//   hence a new filename that downloads naturally.
// - Favicons: stable URLs (e.g. /favicon.ico) whose content can change, so they use the
//   90-day TTL and, when stored validators exist, HTTP conditional revalidation
//   (If-None-Match / If-Modified-Since) so unchanged favicons cost a 304 instead of a
//   re-download.
// Returns { shouldDownload, reason, revalidation? } where revalidation carries stored
// ETag/Last-Modified validators for a conditional request.
function shouldDownloadImage(imageUrl, localPath, metadataPath, type = 'event') {
  // 1. Read metadata and check for URL changes or recent failures
  let metadata = null;
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch (error) {
      console.warn(`⚠️  Could not read metadata for ${localPath}:`, error.message);
      return { shouldDownload: true, reason: 'Invalid metadata file' };
    }
  }

  if (metadata) {
    if (metadata.originalUrl !== imageUrl) {
      return { shouldDownload: true, reason: 'URL has changed' };
    }

    // Check for failure backoff
    if (metadata.failedAt) {
      const failedAge = Date.now() - new Date(metadata.failedAt).getTime();
      const failureCount = metadata.failureCount || 1;

      let backoffDurationDays = 7;
      if (failureCount === 2) {
        backoffDurationDays = 14;
      } else if (failureCount >= 3) {
        backoffDurationDays = 30;
      }

      const backoffDuration = backoffDurationDays * 24 * 60 * 60 * 1000;

      if (failedAge < backoffDuration) {
        const daysRemaining = Math.ceil((backoffDuration - failedAge) / (24 * 60 * 60 * 1000));
        return { shouldDownload: false, reason: `Previous download failed (${failureCount} times), backing off for ${daysRemaining} more days` };
      } else {
        return { shouldDownload: true, reason: 'Backoff period expired, retrying download' };
      }
    }
  }

  // 2. Check if file exists and is non-empty
  if (!fs.existsSync(localPath)) {
    return { shouldDownload: true, reason: 'File does not exist' };
  }
  if (fs.statSync(localPath).size === 0) {
    return { shouldDownload: true, reason: 'File is empty' };
  }

  // 3. Event images never expire — same URL means same bytes
  if (type === 'event') {
    return { shouldDownload: false, reason: 'File exists (URL-fingerprinted, cached indefinitely)' };
  }

  // 4. Favicons: check freshness against the TTL
  if (!metadata) {
    return { shouldDownload: true, reason: 'No metadata file found' };
  }

  // Prefer metadata timestamps over file mtime: CI runs on fresh git checkouts where
  // every file's mtime is the checkout time, so mtime alone would make favicons look
  // permanently fresh. downloadedAt is set on every successful download and
  // lastCheckedAt on every 304 revalidation; mtime remains as a fallback for files
  // downloaded locally before those fields existed.
  const downloadedAtMs = metadata.downloadedAt ? Date.parse(metadata.downloadedAt) : NaN;
  const lastCheckedAtMs = metadata.lastCheckedAt ? Date.parse(metadata.lastCheckedAt) : NaN;
  let lastVerifiedMs = Math.max(
    Number.isNaN(downloadedAtMs) ? 0 : downloadedAtMs,
    Number.isNaN(lastCheckedAtMs) ? 0 : lastCheckedAtMs
  );
  if (lastVerifiedMs === 0) {
    lastVerifiedMs = fs.statSync(localPath).mtime.getTime();
  }
  const fileAge = Date.now() - lastVerifiedMs;

  // Generate a consistent random offset based on the filename to ensure
  // the same file always gets the same randomization
  const filename = path.basename(localPath);
  const hash = filename.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  const randomOffset = (Math.abs(hash) % (CACHE_RANDOMIZATION * 2)) - CACHE_RANDOMIZATION;
  const effectiveCacheDuration = CACHE_DURATION + randomOffset;

  if (fileAge > effectiveCacheDuration) {
    const daysOld = Math.round(fileAge / (24 * 60 * 60 * 1000));
    const effectiveDays = Math.round(effectiveCacheDuration / (24 * 60 * 60 * 1000));
    const revalidation = getStoredValidators(metadata);
    if (revalidation) {
      return {
        shouldDownload: true,
        reason: `File is ${daysOld} days old (expires after ${effectiveDays} days), revalidating via ${revalidation.etag ? 'ETag' : 'Last-Modified'}`,
        revalidation
      };
    }
    return { shouldDownload: true, reason: `File is ${daysOld} days old (expires after ${effectiveDays} days)` };
  }

  return { shouldDownload: false, reason: 'File is up to date' };
}

// Download a single image with size specification.
// options.quiet suppresses the per-attempt failure log and failure metadata —
// used by the favicon fallback ladder, which logs once per domain and records
// misses in the negative cache instead.
async function downloadImageWithSize(imageUrl, type = 'event', size = null, options = {}) {
  try {
    const filename = generateFilename(imageUrl, type, size);
    const dir = type === 'favicon' ? FAVICONS_DIR : EVENTS_DIR;
    const localPath = path.join(dir, filename);
    const metadataPath = localPath + '.meta';
    
    // Check if we should download
    const { shouldDownload, reason, revalidation } = shouldDownloadImage(imageUrl, localPath, metadataPath, type);

    if (!shouldDownload) {
      console.log(`⏭️  Skipping ${type} image: ${filename} (${reason})`);
      return { success: true, skipped: true, filename, reason };
    }

    if (DRY_RUN) {
      console.log(`🔎 [dry-run] Would download ${type} image: ${filename} (${reason})`);
      return { success: true, skipped: true, dryRun: true, filename, reason };
    }

    console.log(`📥 Downloading ${type} image: ${filename} (${reason})`);
    console.log(`   URL: ${imageUrl}`);

    // Download the image (conditionally, when we have stored validators)
    const downloadResult = await downloadFile(imageUrl, localPath, 30000, 5, revalidation);

    // Server confirmed our cached copy is still current — record the check, keep the file
    if (downloadResult.notModified) {
      touchMetadataCheckedAt(metadataPath);
      console.log(`✅ Revalidated ${type} image (HTTP 304, not modified): ${filename}`);
      return { success: true, skipped: true, notModified: true, filename, reason: 'Not modified (HTTP 304)' };
    }

    // Save metadata
    const metadata = {
      originalUrl: imageUrl,
      type: type,
      filename: filename,
      size: size,
      contentType: downloadResult.contentType,
      contentLength: downloadResult.contentLength
    };

    applyDownloadStamp(metadata, downloadResult);
    writeMetadataIfChanged(metadataPath, metadata);

    console.log(`✅ Downloaded ${type} image: ${filename}`);
    return { success: true, skipped: false, filename, localPath };
    
  } catch (error) {
    if (options.quiet) {
      // Caller (favicon fallback ladder) handles logging and failure tracking
      return { success: false, error: error.message, url: imageUrl };
    }

    console.error(`❌ Failed to download ${type} image from ${imageUrl}:`, error.message);

    try {
      const filename = generateFilename(imageUrl, type, size);
      const dir = type === 'favicon' ? FAVICONS_DIR : EVENTS_DIR;
      const metadataPathFallback = path.join(dir, filename) + '.meta';
      ensureDir(dir);
      const failureMetadata = {
        originalUrl: imageUrl,
        error: error.message,
        type: type,
        filename: filename,
        size: size
      };
      saveFailureMetadata(metadataPathFallback, failureMetadata);
    } catch (metaError) {
      console.error(`❌ Failed to write failure metadata for ${type} image ${imageUrl}:`, metaError.message);
    }

    return { success: false, error: error.message, url: imageUrl };
  }
}

// Download a single image
async function downloadImage(imageUrl, type = 'event', isLinktreeProfile = false) {
  try {
    const filename = generateFilename(imageUrl, type);
    const dir = type === 'favicon' ? FAVICONS_DIR : EVENTS_DIR;
    const localPath = path.join(dir, filename);
    const metadataPath = localPath + '.meta';
    
    // Check if we should download
    const { shouldDownload, reason, revalidation } = shouldDownloadImage(imageUrl, localPath, metadataPath, type);

    if (!shouldDownload) {
      console.log(`⏭️  Skipping ${type} image: ${filename} (${reason})`);
      return { success: true, skipped: true, filename, reason };
    }

    if (DRY_RUN) {
      console.log(`🔎 [dry-run] Would download ${type} image: ${filename} (${reason})`);
      return { success: true, skipped: true, dryRun: true, filename, reason };
    }

    console.log(`📥 Downloading ${type} image: ${filename} (${reason})`);
    console.log(`   URL: ${imageUrl}`);

    // Download the image (conditionally, when we have stored validators)
    const downloadResult = await downloadFile(imageUrl, localPath, 30000, 5, revalidation);

    // Server confirmed our cached copy is still current — record the check, keep the file
    if (downloadResult.notModified) {
      touchMetadataCheckedAt(metadataPath);
      console.log(`✅ Revalidated ${type} image (HTTP 304, not modified): ${filename}`);
      return { success: true, skipped: true, notModified: true, filename, reason: 'Not modified (HTTP 304)' };
    }

    // Process Linktree profile pictures with optimization
    if (isLinktreeProfile && type === 'favicon') {
      const tempPath = localPath + '.temp';
      const optimizedPath = localPath + '.optimized';
      try {
        // Move original to temp location
        fs.renameSync(localPath, tempPath);
        // Process and optimize the image
        const processed = await processProfilePicture(tempPath, optimizedPath, targetSize);
        if (processed) {
          // Replace original with optimized version
          fs.renameSync(optimizedPath, localPath);
          console.log(`🎨 Applied optimization to Linktree profile picture`);
        } else {
          // Fallback: restore original if processing failed
          fs.renameSync(tempPath, localPath);
        }
        // Clean up temp file
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        if (fs.existsSync(optimizedPath)) {
          fs.unlinkSync(optimizedPath);
        }
      } catch (processError) {
        console.warn(`⚠️  Image processing failed, using original: ${processError.message}`);
        // Restore original if it was moved
        if (fs.existsSync(tempPath) && !fs.existsSync(localPath)) {
          fs.renameSync(tempPath, localPath);
        }
      }
    }
    
    // Save metadata
    const metadata = {
      originalUrl: imageUrl,
      type: type,
      filename: filename,
      contentType: downloadResult.contentType,
      contentLength: downloadResult.contentLength,
      isLinktreeProfile: isLinktreeProfile
    };

    applyDownloadStamp(metadata, downloadResult);
    writeMetadataIfChanged(metadataPath, metadata);

    console.log(`✅ Downloaded ${type} image: ${filename}`);
    return { success: true, skipped: false, filename, localPath };
    
  } catch (error) {
    console.error(`❌ Failed to download ${type} image from ${imageUrl}:`, error.message);

    try {
      const filename = generateFilename(imageUrl, type);
      const dir = type === 'favicon' ? FAVICONS_DIR : EVENTS_DIR;
      const metadataPathFallback = path.join(dir, filename) + '.meta';
      ensureDir(dir);
      const failureMetadata = {
        originalUrl: imageUrl,
        error: error.message,
        type: type,
        filename: filename
      };
      saveFailureMetadata(metadataPathFallback, failureMetadata);
    } catch (metaError) {
      console.error(`❌ Failed to write failure metadata for ${type} image ${imageUrl}:`, metaError.message);
    }

    return { success: false, error: error.message, url: imageUrl };
  }
}

// Process a website URL and add it to the appropriate collection
function processWebsiteUrl(url, context = '') {
  try {
    if (isImageUrl(url)) {
      console.log(`🖼️  Found direct image URL${context}: ${url}`);
      return { type: 'favicon_direct', url };
    }

    const domain = new URL(url).hostname;
    
    // Check if it's a Linktree URL
    if (isLinktreeUrl(url)) {
      console.log(`🔗 Found Linktree URL${context}: ${url}`);
      return { type: 'linktree', url };
    } else if (isWikipediaUrl(url)) {
      console.log(`📚 Found Wikipedia URL${context}: ${url}`);
      return { type: 'wikipedia', url };
    } else {
      // Use Google's favicon service for regular domains with multiple sizes
      const faviconUrl64 = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
      const faviconUrl256 = `https://www.google.com/s2/favicons?domain=${domain}&sz=256`;
      console.log(`🌐 Found website for favicons${context}: ${domain}`);
      console.log(`   🗺️  Map HD (64px): ${faviconUrl64}`);
      console.log(`   🎨 Cards/OG (256px): ${faviconUrl256}`);
      return { type: 'favicon', urls: { favicon64: faviconUrl64, favicon256: faviconUrl256 } };
    }
  } catch (error) {
    console.warn(`⚠️  Could not extract domain from website URL${context}: ${url}`, error.message);
    return null;
  }
}

// Add a processed URL result to the imageUrls collections
function addProcessedUrl(imageUrls, result) {
  if (!result) return;
  
  if (result.type === 'linktree') {
    imageUrls.linktreeUrls = imageUrls.linktreeUrls || new Set();
    imageUrls.linktreeUrls.add(result.url);
  } else if (result.type === 'wikipedia') {
    imageUrls.wikipediaUrls = imageUrls.wikipediaUrls || new Set();
    imageUrls.wikipediaUrls.add(result.url);
  } else if (result.type === 'favicon') {
    imageUrls.favicons64.add(result.urls.favicon64);
    imageUrls.favicons256.add(result.urls.favicon256);
  } else if (result.type === 'favicon_direct') {
    imageUrls.faviconsDirect = imageUrls.faviconsDirect || new Set();
    imageUrls.faviconsDirect.add(result.url);
  }
}

// Extract image URLs from calendar data using calendar loader
async function extractImageUrls() {
  const imageUrls = {
    eventsWithInfo: [],  // Changed to array of event objects with image info
    favicons64: new Set(),  // Higher quality for map markers
    favicons256: new Set(),   // High quality for cards/OG
    faviconsDirect: new Set(), // Direct image favicons
    linktreeUrls: new Set(),
    wikipediaUrls: new Set()
  };
  
  // Read all calendar files
  const calendarsDir = path.join(ROOT, 'data', 'calendars');
  if (!fs.existsSync(calendarsDir)) {
    console.log('📁 No calendars directory found, skipping image extraction');
    return imageUrls;
  }
  
  const calendarFiles = fs.readdirSync(calendarsDir).filter(file => file.endsWith('.ics'));
  
  // Create a calendar core instance for parsing
  const calendarCore = new CalendarCore();
  
  for (const file of calendarFiles) {
    const filePath = path.join(calendarsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    console.log(`📅 Processing calendar file: ${file}`);
    
    // Use calendar core to parse the iCal data
    const events = calendarCore.parseICalData(content);
    
    console.log(`   Found ${events.length} events`);
    
    for (const event of events) {
      // Extract event images from parsed data with event information
      if (event.image) {
        const cleanUrl = cleanImageUrl(event.image);
        if (cleanUrl.startsWith('http') && cleanUrl.includes('.')) {
          // Adjust Eventbrite image URLs to get uncropped versions
          const adjustedUrl = adjustEventbriteImageUrl(cleanUrl);
          // Store event with its image URL
          imageUrls.eventsWithInfo.push({
            imageUrl: adjustedUrl,
            name: event.name,
            startDate: event.startDate,
            recurring: event.recurring || false
          });
          console.log(`📸 Found event image: ${event.name} (${event.recurring ? 'recurring' : 'one-time'})`);
          if (adjustedUrl !== cleanUrl) {
            console.log(`🎫 Eventbrite: Adjusted image URL for ${event.name}: ${cleanUrl} -> ${adjustedUrl}`);
          }
        }
      }
      // Extract website URLs for favicons
      if (event.favicon) {
        const result = processWebsiteUrl(event.favicon, ` (favicon override for ${event.name})`);
        addProcessedUrl(imageUrls, result);
      }
      if (event.website) {
        const result = processWebsiteUrl(event.website, ` for ${event.name}`);
        addProcessedUrl(imageUrls, result);
      }
    }
  }
  
  // Process bar data for logo extraction
  const barsDir = path.join(ROOT, 'data', 'bars');
  if (fs.existsSync(barsDir)) {
    console.log('🍺 Processing bar data for logo extraction...');
    
    const barFiles = fs.readdirSync(barsDir).filter(file => file.endsWith('.json'));
    
    for (const file of barFiles) {
      const filePath = path.join(barsDir, file);
      const bars = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`📋 Processing bar file: ${file} (${bars.length} bars)`);
      for (const bar of bars) {
        if (bar.favicon) {
          const result = processWebsiteUrl(bar.favicon, ` (favicon override for ${bar.name})`);
          addProcessedUrl(imageUrls, result);
        }

        // Process Wikipedia URLs for bar logos
        if (bar.wikipedia) {
          const result = processWebsiteUrl(bar.wikipedia, ` for ${bar.name}`);
          addProcessedUrl(imageUrls, result);
        }

        // Process website URLs for favicons
        if (bar.website) {
          const result = processWebsiteUrl(bar.website, ` for ${bar.name}`);
          addProcessedUrl(imageUrls, result);
        }
      }
    }
  } else {
    console.log('📁 No bars directory found, skipping bar logo extraction');
  }
  

  // Process bear directory items from Google Sheets
  try {
    console.log('🐻 Processing Bear Directory data for favicons...');
    const SHEET_ID = '1-ttoHpM6unij08U40voVi8YLn7j8Mhld4FkRsKrzql4';
    const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

    // We can use fetchPageContent to get the data as text
    const text = await fetchPageContent(SHEET_URL);
    if (text) {
      const jsonString = text.substring(47).slice(0, -2);
      const json = JSON.parse(jsonString);
      const rows = json.table.rows;

      let directoryItemsProcessed = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.c || !row.c[0] || !row.c[0].v) continue;

        const name = row.c[0] && row.c[0].v ? row.c[0].v.trim() : '';
        const shop = row.c[1] && row.c[1].v ? row.c[1].v.trim() : '';
        const website = row.c[2] && row.c[2].v ? row.c[2].v.trim() : '';
        const instagram = row.c[3] && row.c[3].v ? row.c[3].v.trim() : '';

        const finalUrl = website || shop || (instagram ? `https://instagram.com/${instagram}` : '');

        if (finalUrl && !finalUrl.includes('instagram.com/')) {
          const result = processWebsiteUrl(finalUrl, ` for directory item ${name}`);
          addProcessedUrl(imageUrls, result);
          directoryItemsProcessed++;
        }
      }
      console.log(`✅ Processed ${directoryItemsProcessed} directory items for favicons`);
    }
  } catch (err) {
    console.warn('⚠️  Could not process Bear Directory data:', err.message);
  }

  const linktreeCount = imageUrls.linktreeUrls ? imageUrls.linktreeUrls.size : 0;

  const wikipediaCount = imageUrls.wikipediaUrls ? imageUrls.wikipediaUrls.size : 0;
  console.log(`🔍 Found ${imageUrls.eventsWithInfo.length} event images, ${imageUrls.favicons64.size} favicon URLs (64px), ${imageUrls.favicons256.size} favicon URLs (256px), ${linktreeCount} Linktree URLs, and ${wikipediaCount} Wikipedia URLs`);
  return imageUrls;
}

// Main function
async function main() {
  console.log('🖼️  Starting image download process...');
  if (DRY_RUN) {
    console.log('🔎 Dry-run mode: decisions will be logged but nothing will be downloaded or written');
  }

  // Ensure directories exist
  ensureDir(IMAGES_DIR);
  ensureDir(FAVICONS_DIR);
  ensureDir(EVENTS_DIR);
  
  // Ensure event subdirectories exist using shared utility
  // We'll create a few common directories to ensure the structure exists
  const sampleRecurringDir = getEventDirectoryPath({ recurring: true }, 'img/events');
  const sampleOneTimeDir = getEventDirectoryPath({ 
    recurring: false, 
    startDate: new Date() 
  }, 'img/events');
  
  ensureDir(path.join(ROOT, sampleRecurringDir));
  ensureDir(path.join(ROOT, sampleOneTimeDir));
  
  // Extract image URLs from calendar data
  const imageUrls = await extractImageUrls();
  
  let totalDownloaded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  // Negative cache of domains whose entire favicon fallback ladder failed
  const faviconMissCache = loadFaviconMissCache(FAVICON_MISS_CACHE_PATH);
  const faviconStats = { fetched: 0, fromFallbacks: 0 };

  // Download event images with event information
  console.log('\n📸 Downloading event images...');
  for (const eventWithImage of imageUrls.eventsWithInfo) {
    const result = await downloadEventImage(eventWithImage.imageUrl, {
      name: eventWithImage.name,
      startDate: eventWithImage.startDate,
      recurring: eventWithImage.recurring
    });
    if (result.success) {
      if (result.skipped) {
        totalSkipped++;
      } else {
        totalDownloaded++;
      }
    } else {
      totalFailed++;
    }
  }
  
  
  // Download high-quality favicons (64px for map markers)
  console.log('\n🗺️  Downloading high-quality favicons (64px)...');
  for (const url of imageUrls.favicons64) {
    const result = await downloadFaviconWithFallback(url, '64', faviconMissCache, faviconStats);
    if (result.success) {
      if (result.skipped) {
        totalSkipped++;
      } else {
        totalDownloaded++;
        faviconStats.fetched++;
      }
    } else {
      totalFailed++;
    }
  }

  // Download ultra-high-quality favicons (256px for cards/OG)
  console.log('\n🎨 Downloading ultra-high-quality favicons (256px)...');
  for (const url of imageUrls.favicons256) {
    const result = await downloadFaviconWithFallback(url, '256', faviconMissCache, faviconStats);
    if (result.success) {
      if (result.skipped) {
        totalSkipped++;
      } else {
        totalDownloaded++;
        faviconStats.fetched++;
      }
    } else {
      totalFailed++;
    }
  }

  // Download direct image favicons
  if (imageUrls.faviconsDirect && imageUrls.faviconsDirect.size > 0) {
    console.log('\n🖼️  Downloading direct image favicons...');
    for (const url of imageUrls.faviconsDirect) {
      // Use size '64' so it generates the consistent -64px.ext filename expected by convertWebsiteUrlToFaviconPath
      const result = await downloadImageWithSize(url, 'favicon', '64');
      if (result.success) {
        if (result.skipped) {
          totalSkipped++;
        } else {
          totalDownloaded++;
          faviconStats.fetched++;
        }
      } else {
        totalFailed++;
      }
    }
  }

  // Process Linktree profile pictures with multiple sizes
  if (imageUrls.linktreeUrls && imageUrls.linktreeUrls.size > 0) {
    console.log('\n🔗 Processing Linktree profile pictures with multiple sizes...');
    for (const linktreeUrl of imageUrls.linktreeUrls) {
      try {
        // Extract profile picture URL from Linktree page
        const profilePictureUrl = await extractLinktreeProfilePicture(linktreeUrl);
        if (profilePictureUrl) {
          // Generate multiple sizes for Linktree profile pictures
          const sizes = [
            { size: '64', targetSize: 64, description: 'Map markers (64px)' },
            { size: '256', targetSize: 256, description: 'Cards/OG images (256px)' }
          ];
          for (const { size, targetSize, description } of sizes) {
            const linktreeFilename = generateLinktreeFaviconFilename(linktreeUrl, size);
            console.log(`📥 Processing Linktree ${description}: ${linktreeFilename}`);
            // Download and process the profile picture with the custom filename
            const result = await downloadImageWithCustomFilename(profilePictureUrl, linktreeFilename, 'favicon', true, targetSize);
            if (result.success) {
              if (result.skipped) {
                totalSkipped++;
              } else {
                totalDownloaded++;
              }
            } else {
              totalFailed++;
            }
          }
        } else {
          console.log(`⚠️  Could not extract profile picture from ${linktreeUrl}`);
          totalFailed++;
        }
      } catch (error) {
        console.error(`❌ Failed to process Linktree ${linktreeUrl}:`, error.message);
        totalFailed++;
      }
    }
  }
  
  // Process Wikipedia logos with multiple sizes
  if (imageUrls.wikipediaUrls && imageUrls.wikipediaUrls.size > 0) {
    console.log('\\n📚 Processing Wikipedia logos with multiple sizes...');
    for (const wikipediaUrl of imageUrls.wikipediaUrls) {
      try {
        // Extract logo URL from Wikipedia page
        const logoUrl = await extractWikipediaLogo(wikipediaUrl);
        if (logoUrl) {
          // Generate multiple sizes for Wikipedia logos
          const sizes = [
            { size: '64', targetSize: 64, description: 'Map markers (64px)' },
            { size: '256', targetSize: 256, description: 'Cards/OG images (256px)' }
          ];
          for (const { size, targetSize, description } of sizes) {
            const wikipediaFilename = generateWikipediaFaviconFilename(wikipediaUrl, size);
            console.log(`📥 Processing Wikipedia ${description}: ${wikipediaFilename}`);
            // Download and process the logo with the custom filename
            const result = await downloadImageWithCustomFilename(logoUrl, wikipediaFilename, 'favicon', true, targetSize);
            if (result.success) {
              if (result.skipped) {
                totalSkipped++;
              } else {
                totalDownloaded++;
              }
            } else {
              totalFailed++;
            }
          }
        } else {
          console.log(`⚠️  Could not extract logo from ${wikipediaUrl}`);
          totalFailed++;
        }
      } catch (error) {
        console.error(`❌ Failed to process Wikipedia ${wikipediaUrl}:`, error.message);
        totalFailed++;
      }
    }
  }
  
  // Persist the favicon negative cache (skipped in dry-run: no writes)
  if (!DRY_RUN) {
    saveFaviconMissCache(FAVICON_MISS_CACHE_PATH, faviconMissCache);
  }

  // Summary
  console.log('\n📊 Download Summary:');
  console.log(`✅ Downloaded: ${totalDownloaded}`);
  console.log(`⏭️  Skipped: ${totalSkipped}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`📁 Total processed: ${totalDownloaded + totalSkipped + totalFailed}`);
  console.log(`✓ favicons: ${faviconStats.fetched} fetched, ${faviconStats.fromFallbacks} from fallbacks`);
  const missDomains = Object.keys(faviconMissCache);
  if (missDomains.length > 0) {
    const shown = missDomains.slice(0, 10).join(', ');
    const suffix = missDomains.length > 10 ? ', …' : '';
    console.log(`⚠️ ${missDomains.length} domains unavailable (known misses, retry after 7d): ${shown}${suffix}`);
  }
  
  if (totalFailed > 0) {
    console.log('\n⚠️  Some images failed to download. Check the logs above for details.');
    // We do not exit with 1 because network errors for some images are expected
    // and should not fail the entire CI workflow. We will still log the failures.
  }
  
  console.log('\n🎉 Image download process completed successfully!');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Fatal error during image download:', error);
    process.exit(1);
  });
}

module.exports = { downloadImage, downloadImageWithSize, downloadEventImage, extractImageUrls, extractLinktreeProfilePicture, isLinktreeUrl, extractWikipediaLogo, isWikipediaUrl, fetchPageContent, generateLinktreeFaviconFilename, generateWikipediaFaviconFilename, downloadImageWithCustomFilename, shouldDownloadImage, getGoogleFaviconDomain, buildFaviconFallbackLadder, shouldSkipKnownMiss, recordFaviconMiss, loadFaviconMissCache, saveFaviconMissCache, looksLikeImage, attemptFaviconRungDownload, downloadFaviconWithFallback };

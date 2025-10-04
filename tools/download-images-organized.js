#!/usr/bin/env node

/**
 * Organized Image Download Script
 * Downloads and organizes images using the new event-based structure
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { JSDOM } = require('jsdom');

// Import shared filename utilities
const { 
    generateFilenameFromUrl, 
    generateFaviconFilename, 
    cleanImageUrl,
    convertImageUrlToOrganizedPath,
    generateEventFolderPath,
    getImageExtension
} = require('../js/filename-utils.js');

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
const CalendarCore = require('../js/calendar-core.js');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'img');
const FAVICONS_DIR = path.join(IMAGES_DIR, 'favicons');
const EVENTS_DIR = path.join(IMAGES_DIR, 'events');

// Cache duration: 14 days (2 weeks) in milliseconds
const CACHE_DURATION = 14 * 24 * 60 * 60 * 1000;

// Randomization factor: ±2 days to prevent all favicons from expiring simultaneously
const CACHE_RANDOMIZATION = 2 * 24 * 60 * 60 * 1000;

// No complex image manager needed - keep it simple

// Ensure directories exist
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Download file with timeout and redirect handling
function downloadFile(url, outputPath, timeout = 30000, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const downloadWithRedirects = (currentUrl, redirectCount = 0) => {
      if (redirectCount > maxRedirects) {
        reject(new Error(`Too many redirects (max: ${maxRedirects})`));
        return;
      }
      
      const parsedUrl = new URL(currentUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const request = client.get(currentUrl, {
        timeout: timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; chunky.dad-image-downloader/1.0)',
          'Accept': 'image/*,*/*;q=0.8'
        }
      }, (response) => {
        // Handle redirects (301, 302, 303, 307, 308)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = new URL(response.headers.location, currentUrl).href;
          console.log(`🔄 Following redirect ${redirectCount + 1}/${maxRedirects}: ${currentUrl} -> ${redirectUrl}`);
          downloadWithRedirects(redirectUrl, redirectCount + 1);
          return;
        }
        
        if (response.statusCode >= 200 && response.statusCode < 300) {
          const fileStream = fs.createWriteStream(outputPath);
          response.pipe(fileStream);
          
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
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

// Check if we should download the image
function shouldDownloadImage(imageUrl, localPath, metadataPath) {
  // 1. Check if file exists
  if (!fs.existsSync(localPath)) {
    return { shouldDownload: true, reason: 'File does not exist' };
  }
  
  // 2. Check file age with randomization
  const fileAge = Date.now() - fs.statSync(localPath).mtime.getTime();
  
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
    return { shouldDownload: true, reason: `File is ${daysOld} days old (expires after ${effectiveDays} days)` };
  }
  
  // 3. Check if URL changed
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (metadata.originalUrl !== imageUrl) {
        return { shouldDownload: true, reason: 'URL has changed' };
      }
    } catch (error) {
      console.warn(`⚠️  Could not read metadata for ${localPath}:`, error.message);
      return { shouldDownload: true, reason: 'Invalid metadata file' };
    }
  } else {
    return { shouldDownload: true, reason: 'No metadata file found' };
  }
  
  return { shouldDownload: false, reason: 'File is up to date' };
}

// Download and organize event images
async function downloadEventImages(events) {
  console.log('📸 Downloading and organizing event images...');
  
  let totalDownloaded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  
  for (const event of events) {
    if (!event.image) continue;
    
    try {
      const folderPath = generateEventFolderPath(event);
      if (!folderPath) {
        console.warn(`⚠️  Could not generate folder path for event: ${event.name || 'Unknown'}`);
        continue;
      }
      
      console.log(`   Processing event: ${event.name || 'Unknown'}`);
      console.log(`   Folder: ${folderPath}`);
      
      // Create event directory
      const eventDir = path.join(ROOT, folderPath);
      ensureDir(eventDir);
      
      // Create gallery directory
      const galleryDir = path.join(eventDir, 'gallery');
      ensureDir(galleryDir);
      
      // Download primary image
      const extension = getImageExtension(event.image);
      const primaryPath = path.join(eventDir, `primary${extension}`);
      const primaryMetaPath = primaryPath + '.meta';
      
      const { shouldDownload, reason } = shouldDownloadImage(event.image, primaryPath, primaryMetaPath);
      
      if (shouldDownload) {
        console.log(`     📥 Downloading primary image (${reason})`);
        await downloadFile(event.image, primaryPath);
        
        // Save metadata
        const metadata = {
          originalUrl: event.image,
          downloadedAt: new Date().toISOString(),
          type: 'event',
          imageType: 'primary',
          eventName: event.name || 'Unknown Event',
          eventDate: event.startDate || event.date
        };
        
        fs.writeFileSync(primaryMetaPath, JSON.stringify(metadata, null, 2));
        totalDownloaded++;
        console.log(`     ✅ Downloaded primary image`);
      } else {
        console.log(`     ⏭️  Skipping primary image (${reason})`);
        totalSkipped++;
      }
      
    } catch (error) {
      console.error(`   ❌ Failed to process event ${event.name || 'Unknown'}:`, error.message);
      totalFailed++;
    }
  }
  
  console.log(`📊 Event images: ${totalDownloaded} downloaded, ${totalSkipped} skipped, ${totalFailed} failed`);
  return { downloaded: totalDownloaded, skipped: totalSkipped, failed: totalFailed };
}

// Download favicons (unchanged from original)
async function downloadFavicons(events) {
  console.log('🌐 Downloading favicons...');
  
  const faviconUrls = new Set();
  
  for (const event of events) {
    if (event.website) {
      try {
        const domain = new URL(event.website).hostname;
        const faviconUrl64 = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        const faviconUrl256 = `https://www.google.com/s2/favicons?domain=${domain}&sz=256`;
        
        faviconUrls.add(faviconUrl64);
        faviconUrls.add(faviconUrl256);
      } catch (error) {
        console.warn(`⚠️  Could not extract domain from website URL: ${event.website}`, error.message);
      }
    }
  }
  
  let totalDownloaded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  
  for (const url of faviconUrls) {
    try {
      const filename = generateFaviconFilename(url);
      const localPath = path.join(FAVICONS_DIR, filename);
      const metadataPath = localPath + '.meta';
      
      const { shouldDownload, reason } = shouldDownloadImage(url, localPath, metadataPath);
      
      if (shouldDownload) {
        console.log(`   📥 Downloading favicon: ${filename} (${reason})`);
        await downloadFile(url, localPath);
        
        // Save metadata
        const metadata = {
          originalUrl: url,
          downloadedAt: new Date().toISOString(),
          type: 'favicon',
          filename: filename
        };
        
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
        totalDownloaded++;
      } else {
        console.log(`   ⏭️  Skipping favicon: ${filename} (${reason})`);
        totalSkipped++;
      }
    } catch (error) {
      console.error(`   ❌ Failed to download favicon from ${url}:`, error.message);
      totalFailed++;
    }
  }
  
  console.log(`📊 Favicons: ${totalDownloaded} downloaded, ${totalSkipped} skipped, ${totalFailed} failed`);
  return { downloaded: totalDownloaded, skipped: totalSkipped, failed: totalFailed };
}

// Load all events from calendar files
function loadAllEvents() {
  console.log('📅 Loading events from calendar files...');
  
  const events = [];
  const calendarCore = new CalendarCore();
  
  const calendarsDir = path.join(ROOT, 'data', 'calendars');
  if (!fs.existsSync(calendarsDir)) {
    console.log('⚠️  No calendars directory found');
    return events;
  }
  
  const calendarFiles = fs.readdirSync(calendarsDir).filter(file => file.endsWith('.ics'));
  
  for (const file of calendarFiles) {
    const filePath = path.join(calendarsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    console.log(`   Processing: ${file}`);
    
    try {
      const fileEvents = calendarCore.parseICalData(content);
      events.push(...fileEvents);
      console.log(`   Found ${fileEvents.length} events`);
    } catch (error) {
      console.error(`   ❌ Failed to parse ${file}:`, error.message);
    }
  }
  
  console.log(`📊 Total events loaded: ${events.length}`);
  return events;
}

// Main function
async function main() {
  console.log('🖼️  Starting organized image download process...');
  
  // Ensure directories exist
  ensureDir(IMAGES_DIR);
  ensureDir(FAVICONS_DIR);
  ensureDir(EVENTS_DIR);
  
  // Load all events
  const events = loadAllEvents();
  
  if (events.length === 0) {
    console.log('⚠️  No events found, nothing to download');
    return;
  }
  
  // Download event images
  const eventResults = await downloadEventImages(events);
  
  // Download favicons
  const faviconResults = await downloadFavicons(events);
  
  // Summary
  const totalDownloaded = eventResults.downloaded + faviconResults.downloaded;
  const totalSkipped = eventResults.skipped + faviconResults.skipped;
  const totalFailed = eventResults.failed + faviconResults.failed;
  
  console.log('\n📊 Download Summary:');
  console.log(`✅ Downloaded: ${totalDownloaded}`);
  console.log(`⏭️  Skipped: ${totalSkipped}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`📁 Total processed: ${totalDownloaded + totalSkipped + totalFailed}`);
  
  if (totalFailed > 0) {
    console.log('\n⚠️  Some images failed to download. Check the logs above for details.');
    process.exit(1);
  }
  
  console.log('\n🎉 Organized image download process completed successfully!');
  console.log('\nNext steps:');
  console.log('1. Review the new organized structure in img/events/');
  console.log('2. Update your calendar loader to use the new structure');
  console.log('3. Run cleanup script to remove old flat structure images');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Fatal error during image download:', error);
    process.exit(1);
  });
}

module.exports = { main, downloadEventImages, downloadFavicons, loadAllEvents };
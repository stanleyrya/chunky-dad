#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Import shared filename utilities
const { generateFilenameFromUrl, generateFaviconFilename, cleanImageUrl } = require('../js/filename-utils.js');

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

// Cache duration: 7 days in milliseconds
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

// Ensure directories exist
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Download file with timeout
function downloadFile(url, outputPath, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const request = client.get(url, {
      timeout: timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; chunky.dad-image-downloader/1.0)',
        'Accept': 'image/*,*/*;q=0.8'
      }
    }, (response) => {
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
  });
}

// Generate filename from URL using shared utility
function generateFilename(url, type = 'event') {
    if (type === 'favicon') {
        return generateFaviconFilename(url);
    }
    return generateFilenameFromUrl(url);
}

// Check if we should download the image
function shouldDownloadImage(imageUrl, localPath, metadataPath) {
  // 1. Check if file exists
  if (!fs.existsSync(localPath)) {
    return { shouldDownload: true, reason: 'File does not exist' };
  }
  
  // 2. Check file age
  const fileAge = Date.now() - fs.statSync(localPath).mtime.getTime();
  if (fileAge > CACHE_DURATION) {
    return { shouldDownload: true, reason: `File is ${Math.round(fileAge / (24 * 60 * 60 * 1000))} days old` };
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

// Download a single image
async function downloadImage(imageUrl, type = 'event') {
  try {
    const filename = generateFilename(imageUrl, type);
    const dir = type === 'favicon' ? FAVICONS_DIR : EVENTS_DIR;
    const localPath = path.join(dir, filename);
    const metadataPath = localPath + '.meta';
    
    // Check if we should download
    const { shouldDownload, reason } = shouldDownloadImage(imageUrl, localPath, metadataPath);
    
    if (!shouldDownload) {
      console.log(`⏭️  Skipping ${type} image: ${filename} (${reason})`);
      return { success: true, skipped: true, filename, reason };
    }
    
    console.log(`📥 Downloading ${type} image: ${filename} (${reason})`);
    console.log(`   URL: ${imageUrl}`);
    
    // Download the image
    await downloadFile(imageUrl, localPath);
    
    // Save metadata
    const metadata = {
      originalUrl: imageUrl,
      downloadedAt: new Date().toISOString(),
      type: type,
      filename: filename
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`✅ Downloaded ${type} image: ${filename}`);
    return { success: true, skipped: false, filename, localPath };
    
  } catch (error) {
    console.error(`❌ Failed to download ${type} image from ${imageUrl}:`, error.message);
    return { success: false, error: error.message, url: imageUrl };
  }
}

// Extract image URLs from calendar data using calendar loader
function extractImageUrls() {
  const imageUrls = {
    events: new Set(),
    favicons: new Set()
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
      // Extract event images from parsed data
      if (event.image) {
        const cleanUrl = cleanImageUrl(event.image);
        if (cleanUrl.startsWith('http') && cleanUrl.includes('.')) {
          // Debug: Print Wix URLs for investigation
          if (cleanUrl.includes('wixstatic.com')) {
            console.log(`🔍 WIX URL: ${cleanUrl}`);
          }
          imageUrls.events.add(cleanUrl);
          console.log(`📸 Found event image: ${cleanUrl}`);
        }
      }
      
      // Extract website URLs for favicons
      if (event.website) {
        try {
          const domain = new URL(event.website).hostname;
          const faviconUrls = [
            `https://${domain}/favicon.ico`,
            `https://${domain}/favicon.png`,
            `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
          ];
          
          // Add the first favicon URL (most common)
          imageUrls.favicons.add(faviconUrls[0]);
          
          console.log(`🌐 Found website for favicon: ${domain} -> ${faviconUrls[0]}`);
        } catch (error) {
          console.warn(`⚠️  Could not extract domain from website URL: ${event.website}`, error.message);
        }
      }
    }
  }
  
  console.log(`🔍 Found ${imageUrls.events.size} event images and ${imageUrls.favicons.size} favicon URLs`);
  return imageUrls;
}

// Main function
async function main() {
  console.log('🖼️  Starting image download process...');
  
  // Ensure directories exist
  ensureDir(IMAGES_DIR);
  ensureDir(FAVICONS_DIR);
  ensureDir(EVENTS_DIR);
  
  // Extract image URLs from calendar data
  const imageUrls = extractImageUrls();
  
  let totalDownloaded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  
  // Download event images
  console.log('\n📸 Downloading event images...');
  for (const url of imageUrls.events) {
    const result = await downloadImage(url, 'event');
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
  
  // Download favicons
  console.log('\n🌐 Downloading favicons...');
  for (const url of imageUrls.favicons) {
    const result = await downloadImage(url, 'favicon');
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
  
  // Summary
  console.log('\n📊 Download Summary:');
  console.log(`✅ Downloaded: ${totalDownloaded}`);
  console.log(`⏭️  Skipped: ${totalSkipped}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`📁 Total processed: ${totalDownloaded + totalSkipped + totalFailed}`);
  
  if (totalFailed > 0) {
    console.log('\n⚠️  Some images failed to download. Check the logs above for details.');
    process.exit(1);
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

module.exports = { downloadImage, extractImageUrls };
#!/usr/bin/env node

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
    convertWebsiteUrlToFaviconPath
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

// Ensure directories exist
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Check if a URL is a Linktree
function isLinktreeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.hostname === 'linktr.ee' || parsedUrl.hostname === 'www.linktr.ee';
  } catch (error) {
    return false;
  }
}



// Extract profile picture URL from Linktree page
async function extractLinktreeProfilePicture(linktreeUrl) {
  try {
    console.log(`🔍 Extracting profile picture from Linktree: ${linktreeUrl}`);
    
    // Fetch the Linktree page HTML
    const html = await fetchPageContent(linktreeUrl);
    
    // Parse HTML with JSDOM
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Look for the profile picture element
    const profilePictureDiv = document.querySelector('#profile-picture');
    if (!profilePictureDiv) {
      console.log('⚠️  No profile picture div found on Linktree page');
      return null;
    }
    
    const img = profilePictureDiv.querySelector('img');
    if (!img || !img.src) {
      console.log('⚠️  No profile picture image found in profile-picture div');
      return null;
    }
    
    const profilePictureUrl = img.src;
    console.log(`✅ Found profile picture URL: ${profilePictureUrl}`);
    
    return profilePictureUrl;
    
  } catch (error) {
    console.error(`❌ Failed to extract profile picture from Linktree:`, error.message);
    return null;
  }
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

// Process and optimize image (resize to 96x96 and compress)
async function processProfilePicture(inputPath, outputPath) {
  try {
    const sharp = require('sharp');
    
    // Get image metadata
    const metadata = await sharp(inputPath).metadata();
    console.log(`📏 Original image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);
    
    // Process the image: resize to 96x96, maintain aspect ratio, optimize
    await sharp(inputPath)
      .resize(96, 96, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({
        quality: 85,
        progressive: true,
        mozjpeg: true
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

// Generate filename from URL using shared utility
function generateFilename(url, type = 'event') {
    if (type === 'favicon') {
        return generateFaviconFilename(url);
    }
    return generateFilenameFromUrl(url);
}


// Download image with a custom filename
async function downloadImageWithCustomFilename(imageUrl, customFilename, type = 'event', isLinktreeProfile = false) {
  try {
    const dir = type === 'favicon' ? FAVICONS_DIR : EVENTS_DIR;
    const localPath = path.join(dir, customFilename);
    const metadataPath = localPath + '.meta';
    
    // Check if we should download
    const { shouldDownload, reason } = shouldDownloadImage(imageUrl, localPath, metadataPath);
    
    if (!shouldDownload) {
      console.log(`⏭️  Skipping ${type} image: ${customFilename} (${reason})`);
      return { success: true, skipped: true, filename: customFilename, reason };
    }
    
    console.log(`📥 Downloading ${type} image: ${customFilename} (${reason})`);
    console.log(`   URL: ${imageUrl}`);
    
    // Download the image
    await downloadFile(imageUrl, localPath);
    
    // Process Linktree and Instagram profile pictures with optimization
    if ((isLinktreeProfile && type === 'favicon') || (type === 'favicon' && customFilename.includes('instagram'))) {
      const tempPath = localPath + '.temp';
      const optimizedPath = localPath + '.optimized';
      
      try {
        // Move original to temp location
        fs.renameSync(localPath, tempPath);
        
        // Process and optimize the image
        const processed = await processProfilePicture(tempPath, optimizedPath);
        
        if (processed) {
          // Replace original with optimized version
          fs.renameSync(optimizedPath, localPath);
          const profileType = customFilename.includes('instagram') ? 'Instagram' : 'Linktree';
          console.log(`🎨 Applied optimization to ${profileType} profile picture`);
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
      downloadedAt: new Date().toISOString(),
      type: type,
      filename: customFilename,
      isLinktreeProfile: isLinktreeProfile
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`✅ Downloaded ${type} image: ${customFilename}`);
    return { success: true, skipped: false, filename: customFilename, localPath };
    
  } catch (error) {
    console.error(`❌ Failed to download ${type} image from ${imageUrl}:`, error.message);
    return { success: false, error: error.message, url: imageUrl };
  }
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

// Download a single image
async function downloadImage(imageUrl, type = 'event', isLinktreeProfile = false) {
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
    
    // Process Linktree and Instagram profile pictures with optimization
    if ((isLinktreeProfile && type === 'favicon') || (type === 'favicon' && customFilename.includes('instagram'))) {
      const tempPath = localPath + '.temp';
      const optimizedPath = localPath + '.optimized';
      
      try {
        // Move original to temp location
        fs.renameSync(localPath, tempPath);
        
        // Process and optimize the image
        const processed = await processProfilePicture(tempPath, optimizedPath);
        
        if (processed) {
          // Replace original with optimized version
          fs.renameSync(optimizedPath, localPath);
          const profileType = customFilename.includes('instagram') ? 'Instagram' : 'Linktree';
          console.log(`🎨 Applied optimization to ${profileType} profile picture`);
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
      downloadedAt: new Date().toISOString(),
      type: type,
      filename: filename,
      isLinktreeProfile: isLinktreeProfile
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
          
          // Check if it's a Linktree URL
          if (isLinktreeUrl(event.website)) {
            console.log(`🔗 Found Linktree URL: ${event.website}`);
            // Store the Linktree URL for special processing
            imageUrls.linktreeUrls = imageUrls.linktreeUrls || new Set();
            imageUrls.linktreeUrls.add(event.website);
          } else {
            // Use Google's favicon service for regular domains
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
            imageUrls.favicons.add(faviconUrl);
            console.log(`🌐 Found website for favicon: ${domain} -> ${faviconUrl}`);
          }
        } catch (error) {
          console.warn(`⚠️  Could not extract domain from website URL: ${event.website}`, error.message);
        }
    }
  }
  
  const linktreeCount = imageUrls.linktreeUrls ? imageUrls.linktreeUrls.size : 0;
  console.log(`🔍 Found ${imageUrls.events.size} event images, ${imageUrls.favicons.size} favicon URLs, and ${linktreeCount} Linktree URLs`);
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
  
  // Process Linktree profile pictures
  if (imageUrls.linktreeUrls && imageUrls.linktreeUrls.size > 0) {
    console.log('\n🔗 Processing Linktree profile pictures...');
    for (const linktreeUrl of imageUrls.linktreeUrls) {
      try {
        // Extract profile picture URL from Linktree page
        const profilePictureUrl = await extractLinktreeProfilePicture(linktreeUrl);
        
        if (profilePictureUrl) {
          // Generate a unique filename using the shared function
          const linktreeFilename = convertWebsiteUrlToFaviconPath(linktreeUrl, 'img/favicons').split('/').pop();
          
          // Download the profile picture with the custom filename
          const result = await downloadImageWithCustomFilename(profilePictureUrl, linktreeFilename, 'favicon', true);
          if (result.success) {
            if (result.skipped) {
              totalSkipped++;
            } else {
              totalDownloaded++;
            }
          } else {
            totalFailed++;
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
module.exports = { downloadImage, extractImageUrls, extractLinktreeProfilePicture, isLinktreeUrl, fetchPageContent, downloadImageWithCustomFilename, shouldDownloadImage };


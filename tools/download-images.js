#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { JSDOM } = require('jsdom');

// Import shared filename utilities
const { generateFilenameFromUrl, generateFaviconFilename, generateEventFilename, cleanImageUrl, getEventDirectoryPath, convertImageUrlToLocalPath, detectFileExtension } = require('../js/filename-utils.js');

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

// Extract domain from Google favicon URL
function extractDomainFromFaviconUrl(faviconUrl) {
  try {
    const url = new URL(faviconUrl);
    const domain = url.searchParams.get('domain');
    return domain ? `https://${domain}` : 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

// Simple image downloader - just downloads images based on URL
async function downloadImageWithInfo(imageUrl, info) {
  try {
    // Adjust Eventbrite image URLs to get uncropped versions
    const adjustedUrl = adjustEventbriteImageUrl(imageUrl);
    
    // Determine directory based on URL pattern
    let dirPath;
    if (imageUrl.includes('google.com/s2/favicons')) {
      dirPath = 'img/favicons';
    } else if (imageUrl.includes('wikipedia.org') || imageUrl.includes('wikimedia.org')) {
      dirPath = 'img/bars';
    } else {
      // Default to events directory
      dirPath = info && info.startDate ? getEventDirectoryPath(info, 'img/events') : 'img/events';
    }
    
    const dir = path.join(ROOT, dirPath);
    ensureDir(dir);
    
    // Detect file extension
    const detectedExtension = detectFileExtension(adjustedUrl);
    
    // Generate filename based on URL
    let filename;
    if (imageUrl.includes('google.com/s2/favicons')) {
      filename = generateFaviconFilename(adjustedUrl, detectedExtension);
    } else if (imageUrl.includes('wikipedia.org') || imageUrl.includes('wikimedia.org')) {
      filename = generateBarFilename(adjustedUrl, info, detectedExtension);
    } else if (info && info.linktreeUrl) {
      filename = generateLinktreeFaviconFilename(adjustedUrl, detectedExtension);
    } else {
      filename = generateEventFilename(adjustedUrl, info, detectedExtension);
    }
    
    const localPath = path.join(dir, filename);
    const metadataPath = localPath + '.meta';
    
    // Check if we should download
    const { shouldDownload, reason } = shouldDownloadImage(imageUrl, localPath, metadataPath);
    
    if (!shouldDownload) {
      console.log(`⏭️  Skipping image: ${filename} (${reason})`);
      return { success: true, skipped: true, filename, reason };
    }
    
    console.log(`📥 Downloading image: ${filename} (${reason})`);
    console.log(`   Path: ${path.relative(ROOT, localPath)}`);
    console.log(`   Original URL: ${imageUrl}`);
    if (adjustedUrl !== imageUrl) {
      console.log(`   Adjusted URL: ${adjustedUrl}`);
    }
    console.log(`   Detected extension: ${detectedExtension}`);
    
    // Download the image
    const downloadResult = await downloadFile(adjustedUrl, localPath);
    
    // Handle extension correction if needed
    if (downloadResult.contentType) {
      const actualExtension = detectFileExtension(adjustedUrl, downloadResult.contentType);
      
      if (actualExtension !== detectedExtension) {
        console.log(`🔄 Content type detected different extension: ${actualExtension} (was ${detectedExtension})`);
        
        // Generate new filename with correct extension
        let correctFilename;
        if (imageUrl.includes('google.com/s2/favicons')) {
          correctFilename = generateFaviconFilename(adjustedUrl, actualExtension);
        } else if (imageUrl.includes('wikipedia.org') || imageUrl.includes('wikimedia.org')) {
          correctFilename = generateBarFilename(adjustedUrl, info, actualExtension);
        } else if (info && info.linktreeUrl) {
          correctFilename = generateLinktreeFaviconFilename(adjustedUrl, actualExtension);
        } else {
          correctFilename = generateEventFilename(adjustedUrl, info, actualExtension);
        }
        
        const correctPath = path.join(dir, correctFilename);
        const correctMetadataPath = correctPath + '.meta';
        
        // Move the file to the correct name
        if (fs.existsSync(localPath)) {
          fs.renameSync(localPath, correctPath);
          if (fs.existsSync(metadataPath)) {
            fs.renameSync(metadataPath, correctMetadataPath);
          }
        }
        
        // Save metadata
        const metadata = createMetadata(imageUrl, adjustedUrl, filename, downloadResult, info);
        fs.writeFileSync(correctMetadataPath, JSON.stringify(metadata, null, 2));
        
        console.log(`✅ Downloaded image: ${correctFilename} (${actualExtension})`);
        return { success: true, skipped: false, filename: correctFilename, localPath: correctPath };
      }
    }
    
    // Save metadata
    const metadata = createMetadata(imageUrl, adjustedUrl, filename, downloadResult, info);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`✅ Downloaded image: ${filename} (${detectedExtension})`);
    return { success: true, skipped: false, filename, localPath };
    
  } catch (error) {
    console.error(`❌ Failed to download image from ${imageUrl}:`, error.message);
    return { success: false, error: error.message, url: imageUrl };
  }
}

// Create metadata object based on type
function createMetadata(originalUrl, adjustedUrl, filename, downloadResult, info) {
  return {
    originalUrl,
    adjustedUrl,
    filename,
    downloadedAt: new Date().toISOString(),
    contentType: downloadResult.contentType,
    contentLength: downloadResult.contentLength,
    info: info || {}
  };
}

// Legacy function for backward compatibility
async function downloadEventImage(imageUrl, eventInfo) {
  return downloadImageWithInfo(imageUrl, eventInfo);
}

// Legacy function for backward compatibility
async function downloadBarImage(imageUrl, barInfo) {
  return downloadImageWithInfo(imageUrl, barInfo);
}

// Generate filename for bar images
function generateBarFilename(imageUrl, barInfo, extension) {
  try {
    // Use Wikipedia URL as base if available, otherwise use bar name + city
    let baseName;
    if (barInfo.wikipedia) {
      const url = new URL(barInfo.wikipedia);
      const pathname = url.pathname.substring(1); // Remove leading slash
      baseName = pathname
        .replace(/[^a-zA-Z0-9._-]/g, '-') // Replace invalid chars with dashes
        .replace(/-+/g, '-') // Collapse multiple dashes
        .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
    } else {
      // Fallback to bar name + city
      baseName = `${barInfo.name}-${barInfo.city}`
        .toLowerCase()
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }
    
    return `bar-${baseName}${extension}`;
  } catch (error) {
    // Fallback to hash-based filename
    const hash = simpleHash(imageUrl);
    return `bar-${hash}${extension}`;
  }
}

// Simple hash function for fallback filenames
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
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
            // Return content type information
            resolve({
              contentType: response.headers['content-type'],
              contentLength: response.headers['content-length']
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

// Generate a unique filename for Linktree profile pictures based on the Linktree URL
function generateLinktreeFaviconFilename(linktreeUrl, size = '32') {
    try {
        const parsedUrl = new URL(linktreeUrl);
        const pathname = parsedUrl.pathname.substring(1); // Remove leading slash
        const cleanPath = pathname
            .replace(/[^a-zA-Z0-9._-]/g, '-') // Replace invalid chars with dashes
            .replace(/-+/g, '-') // Collapse multiple dashes
            .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
        
        return `favicon-linktr.ee-${cleanPath}-${size}px.png`;
    } catch (error) {
        // Fallback to hash-based filename
        const hash = simpleHash(linktreeUrl);
        return `favicon-linktr.ee-${hash}-${size}px.png`;
    }
}

// Download image with a custom filename
async function downloadImageWithCustomFilename(imageUrl, customFilename, type = 'event', isLinktreeProfile = false, targetSize = 96) {
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
    const downloadResult = await downloadFile(imageUrl, localPath);
    
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
      downloadedAt: new Date().toISOString(),
      type: type,
      filename: customFilename,
      contentType: downloadResult.contentType,
      contentLength: downloadResult.contentLength,
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

// Download a single image with size specification
async function downloadImageWithSize(imageUrl, type = 'event', size = null) {
  try {
    const filename = generateFilename(imageUrl, type, size);
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
    const downloadResult = await downloadFile(imageUrl, localPath);
    
    // Save metadata
    const metadata = {
      originalUrl: imageUrl,
      downloadedAt: new Date().toISOString(),
      type: type,
      filename: filename,
      size: size,
      contentType: downloadResult.contentType,
      contentLength: downloadResult.contentLength
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    console.log(`✅ Downloaded ${type} image: ${filename}`);
    return { success: true, skipped: false, filename, localPath };
    
  } catch (error) {
    console.error(`❌ Failed to download ${type} image from ${imageUrl}:`, error.message);
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
    const { shouldDownload, reason } = shouldDownloadImage(imageUrl, localPath, metadataPath);
    
    if (!shouldDownload) {
      console.log(`⏭️  Skipping ${type} image: ${filename} (${reason})`);
      return { success: true, skipped: true, filename, reason };
    }
    
    console.log(`📥 Downloading ${type} image: ${filename} (${reason})`);
    console.log(`   URL: ${imageUrl}`);
    
    // Download the image
    const downloadResult = await downloadFile(imageUrl, localPath);
    
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
      downloadedAt: new Date().toISOString(),
      type: type,
      filename: filename,
      contentType: downloadResult.contentType,
      contentLength: downloadResult.contentLength,
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
    eventsWithInfo: [],  // Changed to array of event objects with image info
    barsWithInfo: [],    // Array of bar objects with image info
    favicons64: new Set(),  // Higher quality for map markers
    favicons256: new Set()   // High quality for cards/OG
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
            // Use Google's favicon service for regular domains with multiple sizes
            const faviconUrl64 = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
            const faviconUrl256 = `https://www.google.com/s2/favicons?domain=${domain}&sz=256`;
            
            imageUrls.favicons64.add(faviconUrl64);
            imageUrls.favicons256.add(faviconUrl256);
            
            console.log(`🌐 Found website for favicons: ${domain}`);
            console.log(`   🗺️  Map HD (64px): ${faviconUrl64}`);
            console.log(`   🎨 Cards/OG (256px): ${faviconUrl256}`);
          }
        } catch (error) {
          console.warn(`⚠️  Could not extract domain from website URL: ${event.website}`, error.message);
        }
      }
    }
  }
  
  // Extract bar images from bars data
  console.log('\\n🍺 Extracting bar images...');
  const barsDir = path.join(ROOT, 'data', 'bars');
  if (fs.existsSync(barsDir)) {
    const barFiles = fs.readdirSync(barsDir).filter(file => file.endsWith('.json'));
    
    for (const file of barFiles) {
      const filePath = path.join(barsDir, file);
      try {
        const cityBars = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        for (const bar of cityBars) {
          // Extract bar images from Wikipedia scraping
          if (bar.image) {
            const cleanUrl = cleanImageUrl(bar.image);
            if (cleanUrl.startsWith('http') && cleanUrl.includes('.')) {
              imageUrls.barsWithInfo.push({
                imageUrl: cleanUrl,
                name: bar.name,
                city: bar.city,
                wikipedia: bar.wikipedia,
                website: bar.website
              });
              console.log(`🍺 Found bar image: ${bar.name} (${bar.city})`);
            }
          }
          
          // Extract website URLs for favicons
          if (bar.website) {
            try {
              const domain = new URL(bar.website).hostname;
              
              // Check if it's a Linktree URL
              if (isLinktreeUrl(bar.website)) {
                console.log(`🔗 Found Linktree URL: ${bar.website}`);
                // Store the Linktree URL for special processing
                imageUrls.linktreeUrls = imageUrls.linktreeUrls || new Set();
                imageUrls.linktreeUrls.add(bar.website);
              } else {
                // Use Google's favicon service for regular domains with multiple sizes
                const faviconUrl64 = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
                const faviconUrl256 = `https://www.google.com/s2/favicons?domain=${domain}&sz=256`;
                
                imageUrls.favicons64.add(faviconUrl64);
                imageUrls.favicons256.add(faviconUrl256);
                
                console.log(`🌐 Found bar website for favicons: ${domain}`);
                console.log(`   🗺️  Map HD (64px): ${faviconUrl64}`);
                console.log(`   🎨 Cards/OG (256px): ${faviconUrl256}`);
              }
            } catch (error) {
              console.warn(`⚠️  Could not extract domain from bar website URL: ${bar.website}`, error.message);
            }
          }
        }
      } catch (error) {
        console.warn(`⚠️  Could not parse bar file ${file}:`, error.message);
      }
    }
  }
  
  const linktreeCount = imageUrls.linktreeUrls ? imageUrls.linktreeUrls.size : 0;
  console.log(`🔍 Found ${imageUrls.eventsWithInfo.length} event images, ${imageUrls.barsWithInfo.length} bar images, ${imageUrls.favicons64.size} favicon URLs (64px), ${imageUrls.favicons256.size} favicon URLs (256px), and ${linktreeCount} Linktree URLs`);
  return imageUrls;
}

// Main function
async function main() {
  console.log('🖼️  Starting image download process...');
  
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
  const imageUrls = extractImageUrls();
  
  let totalDownloaded = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  
  // Download event images with event information
  console.log('\n📸 Downloading event images...');
  for (const eventWithImage of imageUrls.eventsWithInfo) {
    const result = await downloadImageWithInfo(eventWithImage.imageUrl, {
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
  
  // Download bar images with bar information
  console.log('\\n🍺 Downloading bar images...');
  for (const barWithImage of imageUrls.barsWithInfo) {
    const result = await downloadImageWithInfo(barWithImage.imageUrl, {
      name: barWithImage.name,
      city: barWithImage.city,
      wikipedia: barWithImage.wikipedia,
      website: barWithImage.website
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
    const result = await downloadImageWithInfo(url, { website: extractDomainFromFaviconUrl(url), size: '64' });
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
  
  // Download ultra-high-quality favicons (256px for cards/OG)
  console.log('\n🎨 Downloading ultra-high-quality favicons (256px)...');
  for (const url of imageUrls.favicons256) {
    const result = await downloadImageWithInfo(url, { website: extractDomainFromFaviconUrl(url), size: '256' });
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

module.exports = { downloadImage, downloadImageWithSize, downloadImageWithInfo, downloadEventImage, downloadBarImage, extractImageUrls, extractLinktreeProfilePicture, isLinktreeUrl, fetchPageContent, generateLinktreeFaviconFilename, downloadImageWithCustomFilename, shouldDownloadImage, generateBarFilename };
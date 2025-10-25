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
    generateEventFilename, 
    cleanImageUrl, 
    getEventDirectoryPath, 
    convertImageUrlToLocalPath, 
    detectFileExtension,
    isWikipediaUrl,
    extractWikipediaImageUrl,
    convertWikipediaUrlToImagePath,
    convertUrlToImagePath,
    isImageUrl
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

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'img');
const FAVICONS_DIR = path.join(IMAGES_DIR, 'favicons');
const EVENTS_DIR = path.join(IMAGES_DIR, 'events');

// Cache duration: 14 days (2 weeks) in milliseconds
const CACHE_DURATION = 14 * 24 * 60 * 60 * 1000;

// Randomization factor: ±2 days to prevent all images from expiring simultaneously
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

/**
 * Universal image downloader function
 * Downloads an image from any URL type and saves it with appropriate naming
 * @param {string} url - The URL to download from
 * @param {Object} options - Download options
 * @param {string} options.basePath - Base path for saving (default: 'img/favicons')
 * @param {Object} options.eventInfo - Event information for event images
 * @param {string} options.type - Image type ('favicon', 'event', 'generic')
 * @param {number} options.size - Target size for favicons (32, 64, 256)
 * @returns {Promise<Object>} - Download result
 */
async function downloadImageFromUrl(url, options = {}) {
  const {
    basePath = 'img/favicons',
    eventInfo = null,
    type = 'favicon',
    size = 64
  } = options;

  try {
    // Clean the URL
    const cleanUrl = cleanImageUrl(url);
    if (!cleanUrl || !cleanUrl.startsWith('http')) {
      return { success: false, error: 'Invalid URL', url };
    }

    let imageUrl = cleanUrl;
    let isLinktreeProfile = false;

    // Handle different URL types
    if (isWikipediaUrl(url)) {
      console.log(`📚 Processing Wikipedia URL: ${url}`);
      const extractedImageUrl = await extractWikipediaImageUrl(url);
      if (extractedImageUrl) {
        imageUrl = extractedImageUrl;
        console.log(`✅ Extracted image from Wikipedia: ${imageUrl}`);
      } else {
        return { success: false, error: 'No image found on Wikipedia page', url };
      }
    } else if (isLinktreeUrl(url)) {
      console.log(`🔗 Processing Linktree URL: ${url}`);
      const extractedImageUrl = await extractLinktreeProfilePicture(url);
      if (extractedImageUrl) {
        imageUrl = extractedImageUrl;
        isLinktreeProfile = true;
        console.log(`✅ Extracted profile picture from Linktree: ${imageUrl}`);
      } else {
        return { success: false, error: 'No profile picture found on Linktree page', url };
      }
    }

    // Generate local path
    let localPath;
    if (eventInfo) {
      // Use event-specific path
      localPath = convertImageUrlToLocalPath(imageUrl, eventInfo, basePath);
    } else {
      // Use universal path conversion
      localPath = convertUrlToImagePath(url, basePath);
    }

    // Ensure the directory exists
    const dir = path.dirname(localPath);
    ensureDir(dir);

    const metadataPath = localPath + '.meta';

    // Check if we should download
    const { shouldDownload, reason } = shouldDownloadImage(imageUrl, localPath, metadataPath);
    
    if (!shouldDownload) {
      console.log(`⏭️  Skipping image: ${path.basename(localPath)} (${reason})`);
      return { success: true, skipped: true, filename: path.basename(localPath), reason };
    }

    console.log(`📥 Downloading image: ${path.basename(localPath)} (${reason})`);
    console.log(`   URL: ${url}`);
    if (imageUrl !== url) {
      console.log(`   Image URL: ${imageUrl}`);
    }

    // Download the image
    const downloadResult = await downloadFile(imageUrl, localPath);

    // Save metadata
    const metadata = {
      originalUrl: url,
      imageUrl: imageUrl,
      downloadedAt: new Date().toISOString(),
      type: type,
      filename: path.basename(localPath),
      contentType: downloadResult.contentType,
      contentLength: downloadResult.contentLength,
      isLinktreeProfile: isLinktreeProfile,
      isWikipedia: isWikipediaUrl(url)
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`✅ Downloaded image: ${path.basename(localPath)}`);
    return { 
      success: true, 
      skipped: false, 
      filename: path.basename(localPath), 
      localPath,
      metadata
    };

  } catch (error) {
    console.error(`❌ Failed to download image from ${url}:`, error.message);
    return { success: false, error: error.message, url };
  }
}

/**
 * Download multiple images from URLs
 * @param {Array} urls - Array of URLs to download
 * @param {Object} options - Download options
 * @returns {Promise<Array>} - Array of download results
 */
async function downloadMultipleImages(urls, options = {}) {
  const results = [];
  
  for (const url of urls) {
    const result = await downloadImageFromUrl(url, options);
    results.push(result);
  }
  
  return results;
}

// Main function for command line usage
async function main() {
  console.log('🖼️  Starting universal image downloader...');
  
  // Ensure directories exist
  ensureDir(IMAGES_DIR);
  ensureDir(FAVICONS_DIR);
  ensureDir(EVENTS_DIR);
  
  // Example usage - you can modify this for your needs
  const exampleUrls = [
    'https://en.wikipedia.org/wiki/Stonewall_Inn',
    'https://linktr.ee/example',
    'https://www.google.com',
    'https://example.com/image.jpg'
  ];
  
  console.log('📋 Example URLs to process:');
  exampleUrls.forEach((url, index) => {
    console.log(`   ${index + 1}. ${url}`);
  });
  
  const results = await downloadMultipleImages(exampleUrls, {
    basePath: 'img/favicons',
    type: 'favicon',
    size: 64
  });
  
  // Summary
  const successful = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.success && r.skipped).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log('\n📊 Download Summary:');
  console.log(`✅ Downloaded: ${successful}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📁 Total processed: ${results.length}`);
  
  if (failed > 0) {
    console.log('\n⚠️  Some images failed to download. Check the logs above for details.');
  }
  
  console.log('\n🎉 Universal image downloader completed!');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Fatal error during image download:', error);
    process.exit(1);
  });
}

module.exports = { 
  downloadImageFromUrl, 
  downloadMultipleImages,
  isWikipediaUrl,
  isLinktreeUrl,
  extractWikipediaImageUrl,
  extractLinktreeProfilePicture,
  convertUrlToImagePath
};
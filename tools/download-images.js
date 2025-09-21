#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

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

// Generate filename from URL
function generateFilename(url) {
  try {
    // Handle Eventbrite URLs specially - they have nested URL encoding
    if (url.includes('evbuc.com') && (url.includes('images/') || url.includes('images%2F'))) {
      // Extract the nested URL from the pathname
      const parsedUrl = new URL(url);
      const nestedUrl = decodeURIComponent(parsedUrl.pathname.substring(1)); // Remove leading slash
      
      // Parse the nested URL to get the actual image path
      const nestedParsedUrl = new URL(nestedUrl);
      const imageMatch = nestedParsedUrl.pathname.match(/images\/(\d+)\/(\d+)\/(\d+)\/([^?]+)/);
      
      if (imageMatch) {
        const [, id1, id2, id3, filename] = imageMatch;
        const ext = path.extname(filename) || '.jpg';
        const basename = `evb-${id1}-${id2}-${id3}-${path.basename(filename, ext)}`;
        
        // Sanitize filename
        const sanitized = basename
          .replace(/[^a-zA-Z0-9._-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        return sanitized + ext;
      }
    }
    
    // Handle regular URLs
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const ext = path.extname(pathname) || '.jpg';
    let basename = path.basename(pathname, ext) || 'image';
    
    // Sanitize filename - be more conservative with special characters
    const sanitized = basename
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    return sanitized + ext;
  } catch (error) {
    // Fallback to hash-based filename
    const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
    return `image-${hash}.jpg`;
  }
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
    const filename = generateFilename(imageUrl);
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

// Extract image URLs from calendar data
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
  
  for (const file of calendarFiles) {
    const filePath = path.join(calendarsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extract event images from DESCRIPTION lines (embedded in description)
    // Handle multi-line URLs in iCal format by looking for image: followed by URL
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('image:')) {
        // Find the start of the URL after "image:"
        const imageIndex = line.indexOf('image:');
        let url = line.substring(imageIndex + 6).trim();
        
        // Continue on next lines until we hit another field or end of content
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          // Stop if we hit another field (starts with a letter followed by colon)
          if (nextLine.match(/^[a-zA-Z][a-zA-Z0-9]*:/)) {
            break;
          }
          // In iCal, continuation lines start with a space
          if (nextLine.startsWith(' ')) {
            url += nextLine.substring(1); // Remove leading space
          } else {
            url += nextLine;
          }
          j++;
        }
        
        // Clean up the URL - extract only the actual URL part
        // Look for the first complete URL that ends with a file extension or query parameter
        const urlMatch = url.match(/https?:\/\/[^\s\n]+/);
        if (urlMatch) {
          let cleanUrl = urlMatch[0];
          // Remove any trailing characters that aren't part of the URL
          // Stop at field separators like \n followed by field names
          cleanUrl = cleanUrl.replace(/\\n[a-zA-Z][a-zA-Z0-9]*:.*$/, '');
          cleanUrl = cleanUrl.replace(/[^\w\-._~:/?#[\]@!$&'()*+,;=%]+$/, '');
          
          // Additional cleanup: remove any remaining \n characters and fix escaped commas
          cleanUrl = cleanUrl.replace(/\\n/g, '');
          cleanUrl = cleanUrl.replace(/\\,/g, ',');
          
          // Fix specific issue where 'fac' gets appended to URLs (from 'facebook')
          cleanUrl = cleanUrl.replace(/\.jpgfac$/, '.jpg');
          
          if (cleanUrl.startsWith('http') && cleanUrl.includes('.')) {
            // Debug: Print Wix URLs for investigation
            if (cleanUrl.includes('wixstatic.com')) {
              console.log(`🔍 WIX URL: ${cleanUrl}`);
            }
            imageUrls.events.add(cleanUrl);
          }
        }
      }
    }
    
    // Extract website URLs for favicons (embedded in description)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('website:')) {
        // Find the start of the URL after "website:"
        const websiteIndex = line.indexOf('website:');
        let url = line.substring(websiteIndex + 8).trim();
        
        // Continue on next lines until we hit another field or end of content
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j].trim();
          // Stop if we hit another field (starts with a letter followed by colon)
          if (nextLine.match(/^[a-zA-Z][a-zA-Z0-9]*:/)) {
            break;
          }
          // In iCal, continuation lines start with a space
          if (nextLine.startsWith(' ')) {
            url += nextLine.substring(1); // Remove leading space
          } else {
            url += nextLine;
          }
          j++;
        }
        
        // Clean up the URL - extract only the actual URL part
        const urlMatch = url.match(/https?:\/\/[^\s\n]+/);
        if (urlMatch) {
          let cleanUrl = urlMatch[0];
          // Remove any trailing characters that aren't part of the URL
          cleanUrl = cleanUrl.replace(/\\n[a-zA-Z][a-zA-Z0-9]*:.*$/, '');
          cleanUrl = cleanUrl.replace(/[^\w\-._~:/?#[\]@!$&'()*+,;=%]+$/, '');
          
          // Additional cleanup: remove any remaining \n characters
          cleanUrl = cleanUrl.replace(/\\n/g, '');
          
          if (cleanUrl.startsWith('http') && cleanUrl.includes('.')) {
            // Generate favicon URL - try common favicon locations
            try {
              const domain = new URL(cleanUrl).hostname;
              const faviconUrls = [
                `https://${domain}/favicon.ico`,
                `https://${domain}/favicon.png`,
                `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
              ];
              
              // Add the first favicon URL (most common)
              imageUrls.favicons.add(faviconUrls[0]);
            } catch (error) {
              console.warn(`⚠️  Could not extract domain from website URL: ${cleanUrl}`);
            }
          }
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
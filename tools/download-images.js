#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Import shared filename utilities
const { generateFilenameFromUrl, generateFaviconFilename, cleanImageUrl } = require('../js/filename-utils.js');

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
    
    // Parse iCal content to extract individual events
    const events = parseICalEvents(content);
    
    for (const event of events) {
      // Extract event images from DESCRIPTION
      if (event.description && event.description.includes('image:')) {
        // Find the start of the URL after "image:"
        const imageIndex = event.description.indexOf('image:');
        let url = event.description.substring(imageIndex + 6).trim();
        
        // Clean up the URL - extract only the actual URL part
        // Look for the first complete URL that ends with a file extension or query parameter
        const urlMatch = url.match(/https?:\/\/[^\s\n]+/);
        if (urlMatch) {
          const cleanUrl = cleanImageUrl(urlMatch[0]);
          
          if (cleanUrl.startsWith('http') && cleanUrl.includes('.')) {
            // Debug: Print Wix URLs for investigation
            if (cleanUrl.includes('wixstatic.com')) {
              console.log(`🔍 WIX URL: ${cleanUrl}`);
            }
            imageUrls.events.add(cleanUrl);
          }
        }
      }
      
      // Extract website URLs for favicons
      if (event.description && event.description.includes('website:')) {
        // Find the start of the URL after "website:"
        const websiteIndex = event.description.indexOf('website:');
        let url = event.description.substring(websiteIndex + 8).trim();
        
        console.log(`🔍 Raw website URL: "${url}"`);
        
        // Clean up the URL - extract only the actual URL part
        // Look for complete URLs that may span multiple lines
        // The URL might be split across lines, so we need to find the complete URL
        let cleanUrl = url;
        
        // Remove any trailing characters that aren't part of the URL
        // Stop at \n followed by another field (like \nGoogle Maps:)
        cleanUrl = cleanUrl.replace(/\\n[a-zA-Z][a-zA-Z0-9]*:.*$/, '');
        cleanUrl = cleanUrl.replace(/[^\w\-._~:/?#[\]@!$&'()*+,;=%]+$/, '');
        
        // Additional cleanup: remove any remaining \n characters
        cleanUrl = cleanUrl.replace(/\\n/g, '');
        
        console.log(`🔍 Cleaned URL: "${cleanUrl}"`);
        
        // Extract just the URL part if there are other fields after it
        // Look for a complete URL that ends with a domain (has a dot)
        // Stop at \n followed by another field or at whitespace followed by another field
        const urlMatch = cleanUrl.match(/https?:\/\/[^\s\n]+/);
        if (urlMatch) {
          cleanUrl = urlMatch[0];
          console.log(`🔍 Extracted URL: "${cleanUrl}"`);
        }
        
        // If the URL is still incomplete, try to find a complete domain
        if (cleanUrl.includes('http') && !cleanUrl.includes('.')) {
          // Look for the complete URL by finding the domain part
          const domainMatch = cleanUrl.match(/https?:\/\/[^\/\s\n]+/);
          if (domainMatch) {
            cleanUrl = domainMatch[0];
            console.log(`🔍 Domain-only URL: "${cleanUrl}"`);
          }
        }
        
        // If we still have an incomplete URL, try to extract just the domain
        if (cleanUrl.includes('http') && !cleanUrl.includes('.')) {
          // Look for the domain part after the protocol
          const protocolMatch = cleanUrl.match(/https?:\/\/([^\/\s\n]+)/);
          if (protocolMatch) {
            cleanUrl = `https://${protocolMatch[1]}`;
            console.log(`🔍 Protocol + domain URL: "${cleanUrl}"`);
          }
        }
        
        // If we still have an incomplete URL, try to find a complete domain by looking for the pattern
        if (cleanUrl.includes('http') && !cleanUrl.includes('.')) {
          // Look for the domain part after the protocol, stopping at the next field
          const domainMatch = cleanUrl.match(/https?:\/\/([^\/\s\n]+)/);
          if (domainMatch) {
            cleanUrl = `https://${domainMatch[1]}`;
            console.log(`🔍 Final domain URL: "${cleanUrl}"`);
          }
        }
        
        // If we still have an incomplete URL, try to find a complete domain by looking for the pattern
        if (cleanUrl.includes('http') && !cleanUrl.includes('.')) {
          // Look for the domain part after the protocol, stopping at the next field
          const domainMatch = cleanUrl.match(/https?:\/\/([^\/\s\n]+)/);
          if (domainMatch) {
            cleanUrl = `https://${domainMatch[1]}`;
            console.log(`🔍 Final domain URL: "${cleanUrl}"`);
          }
        }
        
        // If we still have an incomplete URL, try to find a complete domain by looking for the pattern
        if (cleanUrl.includes('http') && !cleanUrl.includes('.')) {
          // Look for the domain part after the protocol, stopping at the next field
          const domainMatch = cleanUrl.match(/https?:\/\/([^\/\s\n]+)/);
          if (domainMatch) {
            cleanUrl = `https://${domainMatch[1]}`;
            console.log(`🔍 Final domain URL: "${cleanUrl}"`);
          }
        }
        
        // If we still have an incomplete URL, try to find a complete domain by looking for the pattern
        if (cleanUrl.includes('http') && !cleanUrl.includes('.')) {
          // Look for the domain part after the protocol, stopping at the next field
          const domainMatch = cleanUrl.match(/https?:\/\/([^\/\s\n]+)/);
          if (domainMatch) {
            cleanUrl = `https://${domainMatch[1]}`;
            console.log(`🔍 Final domain URL: "${cleanUrl}"`);
          }
        }
        
        // If we still have an incomplete URL, try to find a complete domain by looking for the pattern
        if (cleanUrl.includes('http') && !cleanUrl.includes('.')) {
          // Look for the domain part after the protocol, stopping at the next field
          const domainMatch = cleanUrl.match(/https?:\/\/([^\/\s\n]+)/);
          if (domainMatch) {
            cleanUrl = `https://${domainMatch[1]}`;
            console.log(`🔍 Final domain URL: "${cleanUrl}"`);
          }
        }
        
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
            
            console.log(`🌐 Found website for favicon: ${domain} -> ${faviconUrls[0]}`);
          } catch (error) {
            console.warn(`⚠️  Could not extract domain from website URL: ${cleanUrl}`, error.message);
          }
        } else {
          console.log(`⚠️  Invalid URL format: "${cleanUrl}"`);
        }
      }
    }
  }
  
  console.log(`🔍 Found ${imageUrls.events.size} event images and ${imageUrls.favicons.size} favicon URLs`);
  return imageUrls;
}

// Parse iCal content to extract individual events
function parseICalEvents(content) {
  const events = [];
  const lines = content.split('\n');
  let currentEvent = null;
  let inEvent = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.trim() === 'BEGIN:VEVENT') {
      inEvent = true;
      currentEvent = {};
    } else if (line.trim() === 'END:VEVENT') {
      if (currentEvent) {
        events.push(currentEvent);
        currentEvent = null;
      }
      inEvent = false;
    } else if (inEvent && currentEvent && line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const field = line.substring(0, colonIndex);
      let value = line.substring(colonIndex + 1);
      
      // Handle multi-line values (continuation lines start with space)
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith(' ')) {
        value += lines[j].substring(1); // Remove leading space
        j++;
      }
      
      // Store the field value
      if (field === 'DESCRIPTION') {
        currentEvent.description = value;
      } else if (field === 'SUMMARY') {
        currentEvent.summary = value;
      } else if (field === 'LOCATION') {
        currentEvent.location = value;
      }
    }
  }
  
  return events;
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
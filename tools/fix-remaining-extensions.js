#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const EVENTS_DIR = path.join(ROOT, 'img', 'events');

/**
 * Fix files that have invalid extensions (like timestamps)
 * @param {string} filePath - Path to the file to fix
 * @returns {boolean} - True if file was renamed, false otherwise
 */
function fixFileExtension(filePath) {
  const dir = path.dirname(filePath);
  const filename = path.basename(filePath);
  
  // Check if filename has a valid extension
  const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'];
  const hasValidExtension = validExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  
  if (hasValidExtension) {
    return false; // File already has valid extension
  }
  
  // Check if it's a metadata file
  if (filename.endsWith('.meta')) {
    return false; // Skip metadata files
  }
  
  // Try to determine the correct extension by checking file content
  let correctExtension = '.jpg'; // Default to jpg
  
  try {
    // Read first few bytes to check file signature
    const buffer = fs.readFileSync(filePath, { start: 0, end: 10 });
    
    // Check for common image file signatures
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      correctExtension = '.jpg';
    } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      correctExtension = '.png';
    } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      correctExtension = '.gif';
    } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
      correctExtension = '.webp';
    }
  } catch (error) {
    console.warn(`⚠️  Could not read file ${filePath}: ${error.message}`);
    return false;
  }
  
  // Find the last dot in the filename to determine where to add the extension
  const lastDotIndex = filename.lastIndexOf('.');
  let baseFilename;
  
  if (lastDotIndex > 0) {
    // Check if the part after the last dot looks like a timestamp or invalid extension
    const afterDot = filename.substring(lastDotIndex + 1);
    if (afterDot.match(/^\d{8}-\d{6}$/) || // timestamp format like 20250814-194101
        afterDot.match(/^\d+$/) || // just numbers
        !validExtensions.some(ext => afterDot.toLowerCase() === ext.substring(1))) {
      // Replace the invalid extension
      baseFilename = filename.substring(0, lastDotIndex);
    } else {
      // Keep the existing extension
      return false;
    }
  } else {
    // No extension at all
    baseFilename = filename;
  }
  
  const newFilename = baseFilename + correctExtension;
  const newFilePath = path.join(dir, newFilename);
  
  // Check if target file already exists
  if (fs.existsSync(newFilePath)) {
    console.warn(`⚠️  Target file already exists: ${newFilePath}`);
    return false;
  }
  
  try {
    // Rename the file
    fs.renameSync(filePath, newFilePath);
    console.log(`✅ Fixed: ${filename} → ${newFilename}`);
    
    // Also rename the metadata file if it exists
    const metadataPath = filePath + '.meta';
    const newMetadataPath = newFilePath + '.meta';
    if (fs.existsSync(metadataPath)) {
      fs.renameSync(metadataPath, newMetadataPath);
      console.log(`✅ Fixed metadata: ${filename}.meta → ${newFilename}.meta`);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to rename ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Recursively scan directory for files with invalid extensions
 * @param {string} dir - Directory to scan
 * @returns {number} - Number of files fixed
 */
function scanAndFixDirectory(dir) {
  let fixedCount = 0;
  
  if (!fs.existsSync(dir)) {
    console.log(`📁 Directory does not exist: ${dir}`);
    return fixedCount;
  }
  
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const itemPath = path.join(dir, item);
    
    // Check if file still exists (might have been renamed)
    if (!fs.existsSync(itemPath)) {
      continue;
    }
    
    let stat;
    try {
      stat = fs.statSync(itemPath);
    } catch (error) {
      console.warn(`⚠️  Could not stat ${itemPath}: ${error.message}`);
      continue;
    }
    
    if (stat.isDirectory()) {
      // Recursively scan subdirectories
      fixedCount += scanAndFixDirectory(itemPath);
    } else if (stat.isFile()) {
      // Check and fix file extension
      if (fixFileExtension(itemPath)) {
        fixedCount++;
      }
    }
  }
  
  return fixedCount;
}

/**
 * Main function
 */
function main() {
  console.log('🔧 Starting comprehensive image extension fix process...');
  console.log(`📁 Scanning directory: ${EVENTS_DIR}`);
  
  const fixedCount = scanAndFixDirectory(EVENTS_DIR);
  
  console.log(`\n📊 Fix Summary:`);
  console.log(`✅ Files fixed: ${fixedCount}`);
  
  if (fixedCount > 0) {
    console.log('\n🎉 Image extension fix process completed successfully!');
  } else {
    console.log('\n✨ No files needed fixing - all extensions are valid!');
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { fixFileExtension, scanAndFixDirectory };
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// chunky.dad's Toolbox - Manifest Generator
// Automatically generates manifest.json for all test files in the toolbox
// Extracts metadata from each HTML file's meta tags

/**
 * Extract metadata from HTML file
 * Looks for meta tags: data-toolbox-icon and data-toolbox-description
 */
function extractMetadata(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Extract icon from meta tag - use separate patterns for single and double quotes
  let iconMatch = content.match(/<meta\s+name="toolbox-icon"\s+content="([^"]+)"/i);
  if (!iconMatch) {
    iconMatch = content.match(/<meta\s+name='toolbox-icon'\s+content='([^']+)'/i);
  }
  const icon = iconMatch ? iconMatch[1] : '📄';
  
  // Extract description from meta tag - use separate patterns for single and double quotes
  let descMatch = content.match(/<meta\s+name="toolbox-description"\s+content="([^"]+)"/i);
  if (!descMatch) {
    descMatch = content.match(/<meta\s+name='toolbox-description'\s+content='([^']+)'/i);
  }
  const description = descMatch ? descMatch[1] : 'Test file';
  
  return { icon, description };
}

// Get all HTML files in the current directory
const testingDir = __dirname;
const files = fs.readdirSync(testingDir)
  .filter(file => file.endsWith('.html'))
  .map(file => {
    const filePath = path.join(testingDir, file);
    const stats = fs.statSync(filePath);
    const metadata = extractMetadata(filePath);
    
    return {
      name: file,
      size: stats.size,
      icon: metadata.icon,
      description: metadata.description
      // Removed modified timestamp to prevent unnecessary changes during CI
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// Create manifest
const manifest = {
  // Removed generated timestamp to prevent unnecessary changes during CI
  files: files
};

// Write manifest.json
fs.writeFileSync(
  path.join(testingDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`✅ Generated manifest.json with ${files.length} files`);
console.log('📦 Files with metadata:');
files.forEach(f => {
  console.log(`   ${f.icon} ${f.name} - ${f.description}`);
});
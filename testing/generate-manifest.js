#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get all HTML files in the current directory
const testingDir = __dirname;
const files = fs.readdirSync(testingDir)
  .filter(file => file.endsWith('.html'))
  .map(file => {
    const stats = fs.statSync(path.join(testingDir, file));
    return {
      name: file,
      size: stats.size,
      modified: stats.mtime.toISOString()
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// Create manifest
const manifest = {
  generated: new Date().toISOString(),
  files: files
};

// Write manifest.json
fs.writeFileSync(
  path.join(testingDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`Generated manifest.json with ${files.length} files`);
console.log('Files:', files.map(f => f.name).join(', '));
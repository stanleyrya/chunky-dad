#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get all HTML files in the current directory
const testingDir = __dirname;
const files = fs.readdirSync(testingDir)
    .filter(file => file.endsWith('.html') && file !== 'index.html')
    .map(file => {
        const stats = fs.statSync(path.join(testingDir, file));
        return {
            name: file,
            size: stats.size,
            modified: stats.mtime.toISOString()
        };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

// Write to JSON file
const output = {
    generated: new Date().toISOString(),
    files: files
};

fs.writeFileSync(path.join(testingDir, 'file-list.json'), JSON.stringify(output, null, 2));

console.log(`Generated file-list.json with ${files.length} files`);
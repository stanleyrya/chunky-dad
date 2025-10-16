#!/usr/bin/env node

const fs = require('fs');

// Test address extraction specifically
function testAddressExtraction() {
    console.log('🔍 Testing address extraction...');
    
    const html = fs.readFileSync('eagle-nyc.html', 'utf8');
    
    // Try different patterns
    const patterns = [
        /<th[^>]*scope="row"[^>]*class="infobox-label"[^>]*>Address[^>]*<\/th>\s*<td[^>]*class="infobox-data[^"]*"[^>]*>([^<]+)<\/td>/i,
        /<th[^>]*scope="row"[^>]*class="infobox-label"[^>]*>Address[^>]*<\/th>\s*<td[^>]*class="infobox-data[^"]*"[^>]*>([^<]+(?:<[^>]*>[^<]*<\/[^>]*>)*[^<]*)<\/td>/i,
        /<th[^>]*>Address[^>]*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i,
        /Address.*?<td[^>]*>([^<]+)<\/td>/i,
        /Address.*?<td[^>]*>([^<]+(?:<[^>]*>[^<]*<\/[^>]*>)*[^<]*)<\/td>/i
    ];
    
    patterns.forEach((pattern, i) => {
        const match = html.match(pattern);
        console.log(`Pattern ${i + 1}: ${match ? 'MATCH: ' + match[1] : 'NO MATCH'}`);
    });
    
    // Look for the exact structure
    console.log('\n🔍 Looking for exact address structure:');
    const addressRowMatch = html.match(/<tr><th[^>]*>Address[^>]*<\/th><td[^>]*>([^<]+(?:<[^>]*>[^<]*<\/[^>]*>)*[^<]*)<\/td><\/tr>/i);
    console.log('Address row match:', addressRowMatch ? addressRowMatch[1] : 'NOT FOUND');
    
    // Look for the specific address text
    const specificAddressMatch = html.match(/554 West.*?28th Street.*?New York.*?NY 10001.*?United States/i);
    console.log('Specific address match:', specificAddressMatch ? 'FOUND' : 'NOT FOUND');
}

testAddressExtraction();
// Test script for Gaycities Parser
// This script tests the gaycities parser with sample HTML data

// Mock the required modules for testing
const fs = require('fs');
const path = require('path');

// Load the gaycities parser
const { GaycitiesParser } = require('../scripts/parsers/gaycities-parser');

// Mock city configuration
const cityConfig = {
    "nyc": {
        calendar: "chunky-dad-nyc",
        timezone: "America/New_York",
        patterns: ["new york", "nyc", "manhattan", "brooklyn", "queens", "bronx"]
    }
};

// Test function
async function testGaycitiesParser() {
    console.log('🧪 Testing Gaycities Parser...\n');
    
    try {
        // Load test HTML
        const testHtmlPath = path.join(__dirname, 'gaycities-test.html');
        const testHtml = fs.readFileSync(testHtmlPath, 'utf8');
        
        // Create parser instance
        const parser = new GaycitiesParser();
        
        // Mock HTML data object
        const htmlData = {
            html: testHtml,
            url: 'https://newyork.gaycities.com/bars/3486-rockbar-nyc'
        };
        
        // Mock parser config
        const parserConfig = {
            urlDiscoveryDepth: 0,
            maxAdditionalUrls: 10
        };
        
        // Parse the HTML
        console.log('📄 Parsing test HTML...');
        const result = parser.parseEvents(htmlData, parserConfig, cityConfig);
        
        console.log('\n📊 Results:');
        console.log(`Events found: ${result.events.length}`);
        console.log(`Additional links: ${result.additionalLinks.length}`);
        console.log(`Source: ${result.source}`);
        console.log(`URL: ${result.url}`);
        
        if (result.events.length > 0) {
            const event = result.events[0];
            console.log('\n🏳️‍🌈 Bar Event Details:');
            console.log(`Title: ${event.title}`);
            console.log(`Bar: ${event.bar}`);
            console.log(`Address: ${event.address}`);
            console.log(`City: ${event.city}`);
            console.log(`Location: ${event.location}`);
            console.log(`Google Maps: ${event.gmaps}`);
            console.log(`Facebook: ${event.facebook}`);
            console.log(`Instagram: ${event.instagram}`);
            console.log(`Website: ${event.website}`);
            console.log(`Phone: ${event.phone}`);
            console.log(`Description: ${event.description ? event.description.substring(0, 100) + '...' : 'None'}`);
            console.log(`Is Bear Event: ${event.isBearEvent}`);
            console.log(`Source: ${event.source}`);
            console.log(`URL: ${event.url}`);
            
            // Validate expected data
            console.log('\n✅ Validation Results:');
            console.log(`✓ Bar name extracted: ${event.title === 'Rockbar NYC' ? 'PASS' : 'FAIL'}`);
            console.log(`✓ Address extracted: ${event.address && event.address.includes('185 Christopher St') ? 'PASS' : 'FAIL'}`);
            console.log(`✓ City detected: ${event.city === 'nyc' ? 'PASS' : 'FAIL'}`);
            console.log(`✓ Coordinates found: ${event.location && event.location.includes('40.7327194') ? 'PASS' : 'FAIL'}`);
            console.log(`✓ Google Maps URL generated: ${event.gmaps && event.gmaps.includes('google.com/maps') ? 'PASS' : 'FAIL'}`);
            console.log(`✓ Facebook URL extracted: ${event.facebook && event.facebook.includes('facebook.com') ? 'PASS' : 'FAIL'}`);
            console.log(`✓ Instagram URL extracted: ${event.instagram && event.instagram.includes('instagram.com') ? 'PASS' : 'FAIL'}`);
            console.log(`✓ Website URL extracted: ${event.website && event.website.includes('rockbar-nyc.com') ? 'PASS' : 'FAIL'}`);
            console.log(`✓ Phone number extracted: ${event.phone && event.phone.includes('212') ? 'PASS' : 'FAIL'}`);
            console.log(`✓ Description extracted: ${event.description && event.description.length > 50 ? 'PASS' : 'FAIL'}`);
        } else {
            console.log('\n❌ No events found - parser may have issues');
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testGaycitiesParser();
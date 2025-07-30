#!/usr/bin/env node

// Simple Node.js test for the enhanced Eventbrite parser
// This simulates how the parser would work in Scriptable environment

console.log('🎫 Testing Enhanced Eventbrite Parser');
console.log('=====================================');

// Mock the Scriptable environment
global.importModule = undefined; // Simulate non-Scriptable environment

// Mock window and DOMParser for Node.js environment
global.window = undefined;
global.DOMParser = undefined;

// Load the parser
const fs = require('fs');
const path = require('path');

// Read the parser file
const parserPath = path.join(__dirname, '../scripts/core/event-parser-eventbrite.js');
const parserCode = fs.readFileSync(parserPath, 'utf8');

// Create a module context
const moduleContext = {
    console: console,
    setTimeout: setTimeout,
    Promise: Promise,
    Date: Date,
    JSON: JSON,
    encodeURIComponent: encodeURIComponent,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    Array: Array,
    Object: Object,
    Math: Math,
    RegExp: RegExp,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    ReferenceError: ReferenceError,
    TypeError: TypeError,
    SyntaxError: SyntaxError,
    module: { exports: {} },
    exports: {}
};

// Execute the parser code in the module context
const vm = require('vm');
const script = new vm.Script(parserCode);
const context = vm.createContext(moduleContext);
script.runInContext(context);

// Extract the EventbriteEventParser class
const EventbriteEventParser = context.module.exports.EventbriteEventParser || context.EventbriteEventParser;

if (!EventbriteEventParser) {
    console.error('❌ Failed to load EventbriteEventParser from module');
    process.exit(1);
}

// Test data based on user examples
const testData = {
    // Sample HTML from Denver Megawoof event
    sampleHtml: `
    <div class="Container_root__4i85v NestedActionContainer_root__1jtfr event-card event-card__vertical" 
         data-event-location="Denver, CO">
        <a href="https://www.eventbrite.com/e/megawoof-america-denver-massive-2-parties-1-ticket-tickets-1381219547849" 
           rel="noopener" target="_blank" class="event-card-link" 
           aria-label="View MEGAWOOF AMERICA DENVER : MASSIVE 2 Parties 1 Ticket" 
           data-event-id="1381219547849">
            <section class="event-card-details">
                <div class="Stack_root__1ksk7">
                    <h3 class="Typography_root__487rx Typography_body-lg__487rx">
                        MEGAWOOF AMERICA DENVER : MASSIVE 2 Parties 1 Ticket
                    </h3>
                    <p class="Typography_root__487rx Typography_body-md__487rx">
                        Sat, Aug 23 • 9:00 PM - 2:00 AM
                    </p>
                    <p class="Typography_root__487rx Typography_body-md__487rx">
                        Trade
                    </p>
                    <p class="Typography_root__487rx Typography_body-md-bold__487rx">
                        From $16.84
                    </p>
                </div>
            </section>
        </a>
    </div>`,
    
    // Sample with structured data
    structuredDataHtml: `
    <script type="application/ld+json">
    {
        "@type": "Event",
        "name": "MEGAWOOF AMERICA DENVER : MASSIVE 2 Parties 1 Ticket",
        "startDate": "2025-08-23T21:00:00-06:00",
        "endDate": "2025-08-24T02:00:00-06:00",
        "location": {
            "name": "Trade",
            "address": "475 Santa Fe Drive, Denver, CO 80204",
            "geo": {
                "latitude": "39.7392",
                "longitude": "-105.0178"
            }
        },
        "url": "https://www.eventbrite.com/e/megawoof-america-denver-massive-2-parties-1-ticket-tickets-1381219547849"
    }
    </script>
    <div>Event content here...</div>`
};

async function runTests() {
    try {
        console.log('\n📝 Creating parser instance...');
        const parser = new EventbriteEventParser({
            alwaysBear: true,
            requireDetailPages: false
        });
        
        console.log('✅ Parser created successfully');
        
        // Test 1: HTML parsing
        console.log('\n🧪 Test 1: HTML Parsing');
        console.log('------------------------');
        
        const htmlData = {
            html: testData.sampleHtml,
            url: 'https://www.eventbrite.com/o/megawoof-america-18118978189'
        };
        
        const result = parser.parseEvents(htmlData);
        
        if (result.events && result.events.length > 0) {
            const event = result.events[0];
            console.log('✅ Event parsed successfully:');
            console.log(`   📅 Title: ${event.title}`);
            console.log(`   🕐 Date String: ${event.dateString}`);
            console.log(`   🕐 Start Date: ${event.startDate || event.date}`);
            console.log(`   🕐 End Date: ${event.endDate || 'N/A'}`);
            console.log(`   🏢 Venue: ${event.venue}`);
            console.log(`   📍 Address: ${event.address || 'N/A'}`);
            console.log(`   🗺️ Google Maps: ${event.googleMapsLink ? 'Generated' : 'N/A'}`);
            console.log(`   🐻 Bear Event: ${event.isBearEvent ? 'Yes' : 'No'}`);
            
            // Verify expected values
            if (event.venue === 'Trade') {
                console.log('✅ Venue extraction: PASS');
            } else {
                console.log(`❌ Venue extraction: FAIL (expected "Trade", got "${event.venue}")`);
            }
            
            if (event.googleMapsLink) {
                console.log('✅ Google Maps link: PASS');
            } else {
                console.log('❌ Google Maps link: FAIL');
            }
        } else {
            console.log('❌ No events parsed from HTML');
        }
        
        // Test 2: JSON-LD parsing
        console.log('\n🧪 Test 2: JSON-LD Parsing');
        console.log('---------------------------');
        
        const structuredData = {
            html: testData.structuredDataHtml,
            url: 'https://www.eventbrite.com/e/test-event'
        };
        
        const structuredResult = parser.parseEvents(structuredData);
        
        if (structuredResult.events && structuredResult.events.length > 0) {
            const event = structuredResult.events[0];
            console.log('✅ Structured data parsed successfully:');
            console.log(`   📅 Title: ${event.title}`);
            console.log(`   🕐 Start Date: ${event.startDate}`);
            console.log(`   🕐 End Date: ${event.endDate}`);
            console.log(`   🏢 Venue: ${event.venue}`);
            console.log(`   📍 Address: ${event.address}`);
            console.log(`   📍 Coordinates: ${event.coordinates ? `${event.coordinates.lat}, ${event.coordinates.lng}` : 'N/A'}`);
            console.log(`   🗺️ Google Maps: ${event.googleMapsLink ? 'Generated' : 'N/A'}`);
            
            // Verify expected values
            const checks = [
                { name: 'Venue extraction', condition: event.venue === 'Trade', expected: 'Trade', actual: event.venue },
                { name: 'Address extraction', condition: event.address && event.address.includes('475 Santa Fe Drive'), expected: 'Contains address', actual: event.address },
                { name: 'Coordinates extraction', condition: event.coordinates && event.coordinates.lat && event.coordinates.lng, expected: 'Has coordinates', actual: event.coordinates ? 'Yes' : 'No' },
                { name: 'Start/End times', condition: event.startDate && event.endDate, expected: 'Both times', actual: `Start: ${!!event.startDate}, End: ${!!event.endDate}` }
            ];
            
            checks.forEach(check => {
                if (check.condition) {
                    console.log(`✅ ${check.name}: PASS`);
                } else {
                    console.log(`❌ ${check.name}: FAIL (expected: ${check.expected}, actual: ${check.actual})`);
                }
            });
        } else {
            console.log('❌ No events parsed from structured data');
        }
        
        // Test 3: Time parsing
        console.log('\n🧪 Test 3: Time Parsing');
        console.log('------------------------');
        
        const testDates = [
            "Sat, Aug 23 • 9:00 PM - 2:00 AM",
            "Sat, Aug 23 • 9:00 PM",
            "Sun, Dec 15 • 8:00 PM",
            "Fri, Jan 10 • 10:00 PM - 3:00 AM"
        ];
        
        testDates.forEach((dateStr, index) => {
            const parsed = parser.parseDate(dateStr);
            console.log(`Test ${index + 1}: "${dateStr}"`);
            console.log(`   Parsed: ${parsed || 'FAILED'}`);
            console.log(`   Human: ${parsed ? new Date(parsed).toLocaleString() : 'N/A'}`);
        });
        
        console.log('\n🎉 All tests completed!');
        console.log('\n📋 Summary of Enhancements:');
        console.log('   ✅ Enhanced venue/bar name extraction');
        console.log('   ✅ Address extraction from multiple sources');
        console.log('   ✅ GPS coordinates from JSON-LD data');
        console.log('   ✅ Google Maps link generation');
        console.log('   ✅ Improved start/end time parsing');
        console.log('   ✅ Support for both HTML and JSON-LD parsing');
        console.log('   ✅ Geocoding capability (requires HTTP requests)');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error(error.stack);
    }
}

// Run the tests
runTests();
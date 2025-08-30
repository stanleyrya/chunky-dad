#!/usr/bin/env node

/**
 * Manual Calendar Data Fetcher
 * This script fetches calendar data from Google Calendar and saves it locally
 * Useful for testing the new caching system without waiting for GitHub Actions
 */

const fs = require('fs');
const path = require('path');

// Read the city config file
const cityConfigPath = path.join(__dirname, '..', 'js', 'city-config.js');
const cityConfigContent = fs.readFileSync(cityConfigPath, 'utf8');

// Extract CITY_CONFIG object (simple regex approach)
const configMatch = cityConfigContent.match(/const CITY_CONFIG = ({[\s\S]*?});/);
if (!configMatch) {
    console.error('❌ Could not extract CITY_CONFIG from js/city-config.js');
    process.exit(1);
}

// Parse the config using eval (safe in Node.js environment)
let cityConfig;
try {
    // Use eval to parse the JavaScript object literal safely
    const configCode = `(${configMatch[1]})`;
    cityConfig = eval(configCode);
} catch (e) {
    console.error('❌ Could not parse city config:', e.message);
    console.error('Config match:', configMatch[1].substring(0, 200) + '...');
    process.exit(1);
}

// Create output directory
const dataDir = path.join(__dirname, '..', 'data', 'calendars');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 Created data/calendars directory');
}

console.log('🚀 Starting calendar data fetch...\n');

async function fetchCalendarData() {
    const fetchPromises = [];
    
    for (const [cityKey, config] of Object.entries(cityConfig)) {
        if (config.calendarId && config.visible) {
            console.log(`📅 Fetching calendar for ${config.name} (${cityKey})`);
            
            const icalUrl = `https://calendar.google.com/calendar/ical/${config.calendarId}/public/basic.ics`;
            
            fetchPromises.push(
                fetch(icalUrl)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }
                        return response.text();
                    })
                    .then(icalData => {
                        if (!icalData || !icalData.includes('BEGIN:VCALENDAR')) {
                            throw new Error('Invalid iCal data received');
                        }
                        
                        // Save the raw iCal data
                        const outputPath = path.join(dataDir, `${cityKey}.ics`);
                        fs.writeFileSync(outputPath, icalData);
                        
                        console.log(`✅ Saved ${config.name}: ${icalData.length} characters, ${(icalData.match(/BEGIN:VEVENT/g) || []).length} events`);
                        
                        return { cityKey, config, icalData };
                    })
                    .catch(error => {
                        console.error(`❌ Failed to fetch ${config.name}:`, error.message);
                        return { cityKey, config, error: error.message };
                    })
            );
        }
    }
    
    try {
        const results = await Promise.all(fetchPromises);
        
        const summary = {
            lastUpdated: new Date().toISOString(),
            cities: {}
        };
        
        let successCount = 0;
        let errorCount = 0;
        
        results.forEach(result => {
            if (result.error) {
                summary.cities[result.cityKey] = {
                    name: result.config.name,
                    status: 'error',
                    error: result.error,
                    lastUpdated: new Date().toISOString()
                };
                errorCount++;
            } else {
                summary.cities[result.cityKey] = {
                    name: result.config.name,
                    status: 'success',
                    dataLength: result.icalData.length,
                    eventCount: (result.icalData.match(/BEGIN:VEVENT/g) || []).length,
                    lastUpdated: new Date().toISOString()
                };
                successCount++;
            }
        });
        
        // Save summary
        const summaryPath = path.join(dataDir, 'update-summary.json');
        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
        
        console.log('\n📊 Fetch Summary:');
        console.log(`✅ Successful: ${successCount}`);
        console.log(`❌ Failed: ${errorCount}`);
        console.log(`📅 Total cities processed: ${results.length}`);
        
        if (successCount > 0) {
            console.log('\n🎉 Calendar data successfully fetched and saved!');
            console.log('📁 Files saved to: data/calendars/');
            console.log('🌐 You can now test the website with cached calendar data');
        }
        
        if (errorCount > 0) {
            console.log('\n⚠️  Some calendar fetches failed. This is normal during testing.');
            console.log('   The website will show appropriate error messages for failed cities.');
        }
        
    } catch (error) {
        console.error('💥 Fatal error during calendar fetch:', error.message);
        process.exit(1);
    }
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
    console.error('❌ This script requires Node.js 18+ for native fetch support');
    console.error('   Current Node.js version:', process.version);
    console.error('   Please upgrade Node.js or use the GitHub Actions workflow instead');
    process.exit(1);
}

// Run the fetch
fetchCalendarData().catch(error => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
});

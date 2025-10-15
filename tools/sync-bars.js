#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple bars sync script - bidirectional merge
async function syncBars() {
    const googleAppScriptUrl = process.env.GOOGLE_APP_SCRIPT_URL;
    const secretKey = process.env.GOOGLE_APP_SCRIPT_KEY;
    
    if (!googleAppScriptUrl || !secretKey) {
        console.error('Missing required environment variables: GOOGLE_APP_SCRIPT_URL, GOOGLE_APP_SCRIPT_KEY');
        process.exit(1);
    }
    
    try {
        console.log('🔄 Starting bidirectional bars sync...');
        
        // 1. Download bars from Google Sheets
        console.log('📥 Downloading bars from Google Sheets...');
        const sheetsBars = await downloadBarsFromSheets(googleAppScriptUrl, secretKey);
        console.log(`📊 Received ${sheetsBars.length} bars from Google Sheets`);
        
        // 2. Load existing local bars
        console.log('📂 Loading existing local bars...');
        const localBars = await loadLocalBars();
        console.log(`📁 Found ${localBars.length} local bars`);
        
        // 3. Merge data (sheets + local, deduplicated)
        console.log('🔄 Merging bars data...');
        const mergedBars = mergeBars(sheetsBars, localBars);
        console.log(`🔗 Merged into ${mergedBars.length} total bars`);
        
        // 4. Save merged data locally
        console.log('💾 Saving merged data locally...');
        await saveBarsLocally(mergedBars);
        
        // 5. Find bars that exist locally but not in sheets
        console.log('🔍 Finding bars to upload to Google Sheets...');
        const barsToUpload = findBarsToUpload(sheetsBars, localBars);
        console.log(`📤 Found ${barsToUpload.length} bars to upload`);
        
        // 6. Upload missing bars to Google Sheets
        if (barsToUpload.length > 0) {
            console.log('📤 Uploading missing bars to Google Sheets...');
            await uploadBarsToSheets(barsToUpload, googleAppScriptUrl, secretKey);
        }
        
        console.log('✅ Bidirectional sync completed successfully!');
        
    } catch (error) {
        console.error('❌ Error syncing bars:', error.message);
        process.exit(1);
    }
}

// Download bars from Google Sheets
async function downloadBarsFromSheets(url, secretKey) {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('token', secretKey);
    
    const response = await fetch(requestUrl.toString(), {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

// Load existing local bars
async function loadLocalBars() {
    const barsDir = path.join(__dirname, '..', 'data', 'bars');
    const allBars = [];
    
    if (!fs.existsSync(barsDir)) {
        return allBars;
    }
    
    const files = fs.readdirSync(barsDir).filter(file => file.endsWith('.json'));
    
    for (const file of files) {
        const filePath = path.join(barsDir, file);
        try {
            const cityBars = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            allBars.push(...cityBars);
        } catch (error) {
            console.warn(`⚠️  Could not parse ${file}:`, error.message);
        }
    }
    
    return allBars;
}

// Merge bars from sheets and local, deduplicating by name + city
function mergeBars(sheetsBars, localBars) {
    const merged = new Map();
    
    // Add sheets bars first
    sheetsBars.forEach(bar => {
        const key = `${bar.name}-${bar.city}`.toLowerCase();
        merged.set(key, bar);
    });
    
    // Add local bars, only if not already present
    localBars.forEach(bar => {
        const key = `${bar.name}-${bar.city}`.toLowerCase();
        if (!merged.has(key)) {
            merged.set(key, bar);
        }
    });
    
    return Array.from(merged.values());
}

// Save merged bars locally, grouped by city
async function saveBarsLocally(allBars) {
    const barsDir = path.join(__dirname, '..', 'data', 'bars');
    
    if (!fs.existsSync(barsDir)) {
        fs.mkdirSync(barsDir, { recursive: true });
    }
    
    // Group by city
    const barsByCity = {};
    allBars.forEach(bar => {
        const city = bar.city || 'unknown';
        if (!barsByCity[city]) {
            barsByCity[city] = [];
        }
        barsByCity[city].push(bar);
    });
    
    // Write city-specific JSON files
    for (const [city, bars] of Object.entries(barsByCity)) {
        const filePath = path.join(barsDir, `${city}.json`);
        fs.writeFileSync(filePath, JSON.stringify(bars, null, 2));
        console.log(`💾 Saved ${bars.length} bars for ${city}`);
    }
}

// Find bars that exist locally but not in sheets
function findBarsToUpload(sheetsBars, localBars) {
    const sheetsKeys = new Set(
        sheetsBars.map(bar => `${bar.name}-${bar.city}`.toLowerCase())
    );
    
    return localBars.filter(bar => {
        const key = `${bar.name}-${bar.city}`.toLowerCase();
        return !sheetsKeys.has(key);
    });
}

// Upload bars to Google Sheets
async function uploadBarsToSheets(barsToUpload, url, secretKey) {
    for (const bar of barsToUpload) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ...bar,
                    token: secretKey
                })
            });
            
            if (!response.ok) {
                console.warn(`⚠️  Failed to upload ${bar.name}:`, response.status);
            } else {
                console.log(`✅ Uploaded ${bar.name} to Google Sheets`);
            }
        } catch (error) {
            console.warn(`⚠️  Error uploading ${bar.name}:`, error.message);
        }
    }
}

// Run the sync
syncBars();

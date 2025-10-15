#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple bars sync script
async function syncBars() {
    const googleAppScriptUrl = process.env.GOOGLE_APP_SCRIPT_URL;
    const secretKey = process.env.GOOGLE_APP_SCRIPT_KEY;
    
    if (!googleAppScriptUrl || !secretKey) {
        console.error('Missing required environment variables: GOOGLE_APP_SCRIPT_URL, GOOGLE_APP_SCRIPT_KEY');
        process.exit(1);
    }
    
    try {
        console.log('🔄 Syncing bars data from Google Sheets...');
        
        // Fetch data from Google Sheets
        const url = new URL(googleAppScriptUrl);
        url.searchParams.set('token', secretKey);
        
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`📊 Received ${data.length} bars from Google Sheets`);
        
        // Group bars by city
        const barsByCity = {};
        data.forEach(bar => {
            const city = bar.city || 'unknown';
            if (!barsByCity[city]) {
                barsByCity[city] = [];
            }
            barsByCity[city].push(bar);
        });
        
        // Ensure data/bars directory exists
        const barsDir = path.join(__dirname, '..', 'data', 'bars');
        if (!fs.existsSync(barsDir)) {
            fs.mkdirSync(barsDir, { recursive: true });
        }
        
        // Write city-specific JSON files
        for (const [city, bars] of Object.entries(barsByCity)) {
            const filePath = path.join(barsDir, `${city}.json`);
            fs.writeFileSync(filePath, JSON.stringify(bars, null, 2));
            console.log(`💾 Saved ${bars.length} bars for ${city}`);
        }
        
        console.log('✅ Bars sync completed successfully!');
        
    } catch (error) {
        console.error('❌ Error syncing bars:', error.message);
        process.exit(1);
    }
}

// Function to save a bar to Google Sheets
async function saveBarToSheets(barData) {
    const googleAppScriptUrl = process.env.GOOGLE_APP_SCRIPT_URL;
    const secretKey = process.env.GOOGLE_APP_SCRIPT_KEY;
    
    if (!googleAppScriptUrl || !secretKey) {
        throw new Error('Missing required environment variables');
    }
    
    const response = await fetch(googleAppScriptUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            ...barData,
            token: secretKey
        })
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.text();
}

// Run the sync
syncBars();

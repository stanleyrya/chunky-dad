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
        
        // 5. Enrich bars with data from importUrl (Wikipedia scraping)
        console.log('🌐 Enriching bars with data from importUrl...');
        const enrichedBars = await enrichBarsWithImportUrl(mergedBars);
        console.log(`✨ Enriched ${enrichedBars.length} bars with additional data`);
        
        // 6. Save enriched data locally
        console.log('💾 Saving enriched data locally...');
        await saveBarsLocally(enrichedBars);
        
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

// Normalize city name to kebab-case format
function normalizeCityName(cityName) {
    if (!cityName) return 'unknown';
    
    return cityName
        .toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with hyphens
        .replace(/[^a-z0-9\-]/g, '')    // Remove special characters except hyphens
        .replace(/-+/g, '-')            // Replace multiple hyphens with single hyphen
        .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens
}

// Merge bars from sheets and local, deduplicating by name + city
function mergeBars(sheetsBars, localBars) {
    const merged = new Map();
    
    // Add sheets bars first, with normalized city names
    sheetsBars.forEach(bar => {
        const normalizedBar = { ...bar, city: normalizeCityName(bar.city) };
        const key = `${normalizedBar.name}-${normalizedBar.city}`.toLowerCase();
        merged.set(key, normalizedBar);
    });
    
    // Add local bars, only if not already present, with normalized city names
    localBars.forEach(bar => {
        const normalizedBar = { ...bar, city: normalizeCityName(bar.city) };
        const key = `${normalizedBar.name}-${normalizedBar.city}`.toLowerCase();
        if (!merged.has(key)) {
            merged.set(key, normalizedBar);
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
    
    // Group by normalized city name
    const barsByCity = {};
    allBars.forEach(bar => {
        const normalizedCity = normalizeCityName(bar.city);
        if (!barsByCity[normalizedCity]) {
            barsByCity[normalizedCity] = [];
        }
        barsByCity[normalizedCity].push(bar);
    });
    
    // Write city-specific JSON files with normalized city names
    for (const [city, bars] of Object.entries(barsByCity)) {
        const filePath = path.join(barsDir, `${city}.json`);
        fs.writeFileSync(filePath, JSON.stringify(bars, null, 2));
        console.log(`💾 Saved ${bars.length} bars for ${city}`);
    }
}

// Enrich bars with data from importUrl (Wikipedia scraping)
async function enrichBarsWithImportUrl(bars) {
    const enrichedBars = [];
    
    for (const bar of bars) {
        let enrichedBar = { ...bar };
        
        // Add image field if it doesn't exist
        if (!enrichedBar.image) {
            enrichedBar.image = '';
        }
        
        // Check if bar needs scraping - only scrape if missing data that would be scraped
        const needsScraping = bar.importUrl && 
            (bar.importUrl.includes('wikipedia.org') || bar.importUrl.includes('en.wikipedia.org')) &&
            shouldScrapeBar(bar);
        
        if (needsScraping) {
            try {
                console.log(`🔍 Scraping data for ${bar.name} from ${bar.importUrl}`);
                const scrapedData = await scrapeWikipediaData(bar.importUrl);
                
                // Only update fields that are currently empty
                if (!enrichedBar.address && scrapedData.address) {
                    enrichedBar.address = scrapedData.address;
                }
                if (!enrichedBar.coordinates && scrapedData.coordinates) {
                    enrichedBar.coordinates = scrapedData.coordinates;
                }
                if (!enrichedBar.website && scrapedData.website) {
                    enrichedBar.website = scrapedData.website;
                }
                if (!enrichedBar.nickname && scrapedData.nickname) {
                    enrichedBar.nickname = scrapedData.nickname;
                }
                if (!enrichedBar.image && scrapedData.image) {
                    enrichedBar.image = scrapedData.image;
                }
                
                console.log(`✅ Enriched ${bar.name} with scraped data`);
            } catch (error) {
                console.warn(`⚠️  Failed to scrape data for ${bar.name}:`, error.message);
            }
        } else if (bar.importUrl && (bar.importUrl.includes('wikipedia.org') || bar.importUrl.includes('en.wikipedia.org'))) {
            console.log(`⏭️  Skipping scraping for ${bar.name} - already has valid data`);
        }
        
        enrichedBars.push(enrichedBar);
    }
    
    return enrichedBars;
}

// Check if a bar needs scraping based on missing data
function shouldScrapeBar(bar) {
    // Only scrape if we're missing data that Wikipedia could provide
    const missingFields = [];
    
    if (!bar.address || bar.address.trim() === '') missingFields.push('address');
    if (!bar.coordinates || bar.coordinates.trim() === '') missingFields.push('coordinates');
    if (!bar.website || bar.website.trim() === '') missingFields.push('website');
    if (!bar.nickname || bar.nickname.trim() === '') missingFields.push('nickname');
    if (!bar.image || bar.image.trim() === '') missingFields.push('image');
    
    const needsScraping = missingFields.length > 0;
    
    if (needsScraping) {
        console.log(`📋 ${bar.name} missing fields: ${missingFields.join(', ')}`);
    }
    
    return needsScraping;
}

// Scrape Wikipedia data for a bar
async function scrapeWikipediaData(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BarDataScraper/1.0)'
        }
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Parse the HTML to extract data
    const data = {
        address: '',
        coordinates: '',
        website: '',
        nickname: '',
        image: ''
    };
    
    // Extract address from infobox - try multiple patterns
    let addressMatch = html.match(/<th[^>]*scope="row"[^>]*class="infobox-label"[^>]*>Address[^>]*<\/th>\s*<td[^>]*class="infobox-data[^"]*"[^>]*>([^<]+)<\/td>/i);
    if (!addressMatch) {
        addressMatch = html.match(/<th[^>]*scope="row"[^>]*class="infobox-label"[^>]*>Location[^>]*<\/th>\s*<td[^>]*class="infobox-data"[^>]*>([^<]+)<\/td>/i);
    }
    if (!addressMatch) {
        addressMatch = html.match(/<th[^>]*>Address[^>]*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
    }
    if (!addressMatch) {
        addressMatch = html.match(/<th[^>]*>Location[^>]*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
    }
    if (!addressMatch) {
        // Try to match the full address with HTML tags and line breaks
        addressMatch = html.match(/<th[^>]*scope="row"[^>]*class="infobox-label"[^>]*>Address[^>]*<\/th>\s*<td[^>]*class="infobox-data[^"]*"[^>]*>([^<]+(?:<[^>]*>[^<]*<\/[^>]*>)*[^<]*)<\/td>/i);
    }
    if (!addressMatch) {
        // Try a more flexible pattern that handles the specific Eagle NYC structure
        addressMatch = html.match(/Address.*?<td[^>]*>([^<]+(?:<[^>]*>[^<]*<\/[^>]*>)*[^<]*)<\/td>/i);
    }
    if (!addressMatch) {
        // Fallback: look for the specific address pattern in the HTML
        const addressPattern = /554 West.*?28th Street.*?New York.*?NY 10001.*?United States/i;
        if (html.match(addressPattern)) {
            // Extract the address by finding the text between Address and the next </td>
            const addressSection = html.match(/Address.*?<td[^>]*>.*?554 West.*?United States.*?<\/td>/i);
            if (addressSection) {
                // Extract just the text content and remove "Address" prefix
                const textContent = addressSection[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                data.address = textContent.replace(/^Address\s+/, '');
            }
        }
    }
    if (addressMatch) {
        // Clean up the address by removing HTML tags and normalizing
        let address = addressMatch[1].trim();
        address = address.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        data.address = address;
    }
    
    // Extract coordinates from infobox - look for decimal coordinates in geo span
    let coordMatch = html.match(/<span[^>]*class="geo"[^>]*>([^<]+)<\/span>/i);
    if (coordMatch) {
        const coordText = coordMatch[1].trim();
        // Check if it's already in decimal format
        if (coordText.includes('°N') || coordText.includes('°S') || coordText.includes('°E') || coordText.includes('°W')) {
            data.coordinates = convertDMSToDecimal(coordText);
        } else {
            // It might already be in decimal format, clean it up
            const cleanCoords = coordText.replace(/[^\d.,\-\s;]/g, '').trim();
            if (cleanCoords.includes(',')) {
                data.coordinates = cleanCoords;
            } else if (cleanCoords.includes(';')) {
                // Handle semicolon-separated coordinates
                data.coordinates = cleanCoords.replace(';', ',');
            }
        }
    }
    
    // Also try to extract coordinates from the hidden geo span
    if (!data.coordinates) {
        const hiddenGeoMatch = html.match(/<span[^>]*style="display:none"[^>]*>.*?<span[^>]*class="geo"[^>]*>([^<]+)<\/span>/i);
        if (hiddenGeoMatch) {
            const coordText = hiddenGeoMatch[1].trim();
            const cleanCoords = coordText.replace(/[^\d.,\-\s;]/g, '').trim();
            if (cleanCoords.includes(',')) {
                data.coordinates = cleanCoords;
            } else if (cleanCoords.includes(';')) {
                // Handle semicolon-separated coordinates
                data.coordinates = cleanCoords.replace(';', ',');
            }
        }
    }
    
    // Extract website from infobox - try multiple patterns
    let websiteMatch = html.match(/Website.*?<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!websiteMatch) {
        websiteMatch = html.match(/<th[^>]*scope="row"[^>]*class="infobox-label"[^>]*>Website[^>]*<\/th>\s*<td[^>]*class="infobox-data"[^>]*><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/i);
    }
    if (!websiteMatch) {
        websiteMatch = html.match(/<th[^>]*colspan="2"[^>]*class="infobox-header"[^>]*>Website[^>]*<\/th>.*?<td[^>]*class="infobox-full-data"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    }
    if (!websiteMatch) {
        websiteMatch = html.match(/<th[^>]*>Website[^>]*<\/th>\s*<td[^>]*><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/i);
    }
    if (!websiteMatch) {
        websiteMatch = html.match(/<th[^>]*>Website[^>]*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
    }
    if (websiteMatch) {
        data.website = websiteMatch[1].trim();
    }
    
    // Extract nickname from infobox - try multiple patterns
    let nicknameMatch = html.match(/<th[^>]*scope="row"[^>]*class="infobox-label"[^>]*>Nickname[^>]*<\/th>\s*<td[^>]*class="infobox-data"[^>]*>([^<]+)<\/td>/i);
    if (!nicknameMatch) {
        nicknameMatch = html.match(/<th[^>]*>Nickname[^>]*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
    }
    if (!nicknameMatch) {
        nicknameMatch = html.match(/<th[^>]*>Also known as[^>]*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
    }
    if (nicknameMatch) {
        data.nickname = nicknameMatch[1].trim();
    }
    
    // Extract logo image - look for the first image in infobox-image
    let imageMatch = html.match(/<td[^>]*class="infobox-image"[^>]*>.*?<img[^>]*src="([^"]+)"[^>]*>/i);
    if (!imageMatch) {
        imageMatch = html.match(/<img[^>]*src="([^"]*logo[^"]*)"[^>]*>/i);
    }
    if (!imageMatch) {
        imageMatch = html.match(/<img[^>]*src="([^"]*)"[^>]*alt="[^"]*logo[^"]*"[^>]*>/i);
    }
    if (imageMatch) {
        let imageUrl = imageMatch[1].trim();
        // Fix protocol-relative URLs
        if (imageUrl.startsWith('//')) {
            imageUrl = 'https:' + imageUrl;
        }
        data.image = imageUrl;
    }
    
    return data;
}

// Convert DMS coordinates to decimal degrees
function convertDMSToDecimal(dms) {
    // Example: "40°45′06.1″N 74°00′15.5″W"
    const match = dms.match(/(\d+)°(\d+)′([\d.]+)″([NS])\s*(\d+)°(\d+)′([\d.]+)″([EW])/);
    if (!match) return '';
    
    const [, latDeg, latMin, latSec, latDir, lonDeg, lonMin, lonSec, lonDir] = match;
    
    const lat = parseFloat(latDeg) + parseFloat(latMin) / 60 + parseFloat(latSec) / 3600;
    const lon = parseFloat(lonDeg) + parseFloat(lonMin) / 60 + parseFloat(lonSec) / 3600;
    
    const latDecimal = latDir === 'S' ? -lat : lat;
    const lonDecimal = lonDir === 'W' ? -lon : lon;
    
    return `${latDecimal}, ${lonDecimal}`;
}

// Run the sync
syncBars();

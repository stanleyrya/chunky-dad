#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Resolve project root relative to this script
const ROOT = path.resolve(__dirname, '..');

// Load CITY_CONFIG for city pattern mapping
let CITY_CONFIG;
try {
    const cityModule = require(path.join(ROOT, 'js', 'city-config.js'));
    CITY_CONFIG = cityModule.CITY_CONFIG || null;
} catch (error) {
    console.error(`❌ Failed to load CITY_CONFIG: ${error.message}`);
    process.exit(1);
}

if (!CITY_CONFIG || typeof CITY_CONFIG !== 'object') {
    console.error('❌ CITY_CONFIG is missing or invalid in js/city-config.js');
    process.exit(1);
}

const CITY_PATTERNS = buildCityPatterns(CITY_CONFIG);
if (CITY_PATTERNS.length === 0) {
    console.error('❌ CITY_CONFIG has no patterns; cannot normalize bar cities.');
    process.exit(1);
}

// Simplified bars sync script using public Google Sheets (like bear artists)
async function syncBars() {
    console.log('🔄 Starting simplified bars sync...');
    
    try {
        // Google Sheets configuration
        const sheetId = '1-HxzEgKX8LWnWd3KovRcaNCK2JAN9YjbTY8glsVcEAE';
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;
        
        // 1. Download bars from Google Sheets
        console.log('📥 Downloading bars from Google Sheets...');
        const sheetsBars = await downloadBarsFromSheets(sheetUrl);
        console.log(`📊 Received ${sheetsBars.length} bars from Google Sheets`);
        
        // 2. Load existing local bars
        console.log('📂 Loading existing local bars...');
        const localBars = await loadLocalBars();
        console.log(`📁 Found ${localBars.length} local bars`);
        
        // 3. Merge data (sheets + local, deduplicated)
        console.log('🔄 Merging bars data...');
        const mergedBars = mergeBars(sheetsBars, localBars);
        console.log(`🔗 Merged into ${mergedBars.length} total bars`);
        
        // 4. Enrich bars with external data
        console.log('🌐 Enriching bars with external data...');
        const enrichedBars = await enrichBarsWithExternalData(mergedBars);
        console.log(`✨ Enriched ${enrichedBars.length} bars with additional data`);
        
        // 5. Save merged data locally
        console.log('💾 Saving merged data locally...');
        await saveBarsLocally(enrichedBars);
        
        console.log('✅ Simplified sync completed successfully!');
        
    } catch (error) {
        console.error('❌ Error syncing bars:', error.message);
        process.exit(1);
    }
}

// Download bars from Google Sheets using public API
async function downloadBarsFromSheets(sheetUrl) {
    const response = await fetch(sheetUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BarDataScraper/1.0)'
        }
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const text = await response.text();
    
    // Parse Google Sheets JSON response (same as bear artists)
    const jsonString = text.substring(47).slice(0, -2);
    const json = JSON.parse(jsonString);
    
    return parseGoogleSheetsData(json);
}

// Parse Google Sheets data (adapted from bear artists)
function parseGoogleSheetsData(json) {
    const rows = json.table.rows;
    const data = [];
    
    // Skip header row
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.c;
        
        // Extract data from cells - correct column mapping based on actual sheet structure
        let wikipedia = cells[1]?.v || '';     // B: wikipedia
        let gayCities = cells[2]?.v || '';     // C: gayCities
        
        // Fix mixed up data: if wikipedia field contains gaycities.com, move it to gayCities
        if (wikipedia && wikipedia.includes('gaycities.com')) {
            gayCities = wikipedia;
            wikipedia = '';
        }
        
        const bar = {
            name: cells[0]?.v || '',           // A: name
            wikipedia: wikipedia,               // B: wikipedia (corrected)
            gayCities: gayCities,              // C: gayCities (corrected)
            city: cells[3]?.v || '',           // D: city
            googleMaps: cells[4]?.v || '',     // E: googleMaps
            address: cells[5]?.v || '',        // F: address
            coordinates: cells[6]?.v || '',    // G: coordinates
            instagram: cells[7]?.v || '',      // H: instagram
            website: cells[8]?.v || '',        // I: website
            facebook: cells[9]?.v || '',       // J: facebook
            image: ''                          // K: twitter (not used, image field empty for now)
        };
        
        // Clean Instagram username - remove @ symbol and trim
        if (bar.instagram) {
            bar.instagram = bar.instagram.replace('@', '').trim();
        }
        
        if (!bar.name) {
            continue;
        }

        // Only normalize city name if it's not empty and looks like a real city name
        if (bar.city && bar.city.trim() !== '' && !bar.city.startsWith('http')) {
            bar.city = normalizeCityName(bar.city);
        } else {
            throw new Error(`Invalid city value "${bar.city}" for bar "${bar.name}"`);
        }
        
        data.push(bar);
    }
    
    console.log(`📋 Parsed ${data.length} bars from Google Sheets`);
    return data;
}


// Find a specific local bar by name and city
async function findLocalBar(name, city) {
    const barsDir = path.join(__dirname, '..', 'data', 'bars');
    const cityFile = path.join(barsDir, `${city}.json`);
    
    if (!fs.existsSync(cityFile)) {
        return null;
    }
    
    try {
        const cityBars = JSON.parse(fs.readFileSync(cityFile, 'utf8'));
        return cityBars.find(bar => 
            bar.name.toLowerCase() === name.toLowerCase() && 
            bar.city === city
        ) || null;
    } catch (error) {
        return null;
    }
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

// Normalize city name using CITY_CONFIG patterns (no fallbacks)
function normalizeCityName(cityName) {
    if (!cityName) {
        throw new Error('City name missing from bar data.');
    }

    const candidate = String(cityName).trim();
    if (!candidate) {
        throw new Error('City name missing from bar data.');
    }

    const keyMatch = findCityKeyByName(candidate);
    if (keyMatch) {
        return keyMatch;
    }

    const patternMatch = findCityKeyByPattern(candidate);
    if (patternMatch) {
        return patternMatch;
    }

    throw new Error(`Unknown city "${cityName}". Add a matching pattern to CITY_CONFIG.`);
}

function matchesCaseInsensitive(left, right) {
    return String(left || '').trim().localeCompare(String(right || '').trim(), undefined, { sensitivity: 'base' }) === 0;
}

function findCityKeyByName(candidate) {
    const keys = Object.keys(CITY_CONFIG || {});
    for (const key of keys) {
        if (matchesCaseInsensitive(key, candidate)) {
            return key;
        }
    }
    return null;
}

function findCityKeyByPattern(candidate) {
    for (const entry of CITY_PATTERNS) {
        if (matchesCaseInsensitive(entry.pattern, candidate)) {
            return entry.cityKey;
        }
    }
    return null;
}

function buildCityPatterns(cityConfig) {
    const patterns = [];
    Object.entries(cityConfig || {}).forEach(([cityKey, cfg]) => {
        const list = Array.isArray(cfg?.patterns) ? cfg.patterns : [];
        list.forEach(pattern => {
            if (!pattern || !String(pattern).trim()) return;
            patterns.push({ cityKey, pattern });
        });
    });
    return patterns;
}

// Merge bars from sheets and local, deduplicating by name + city
function mergeBars(sheetsBars, localBars) {
    const merged = new Map();
    
    // Add sheets bars first, with normalized city names
    sheetsBars.forEach(bar => {
        // Only normalize city if it's a real city name, not a URL
        let normalizedCity = bar.city;
        if (bar.city && bar.city.trim() !== '' && !bar.city.startsWith('http')) {
            normalizedCity = normalizeCityName(bar.city);
        } else {
            throw new Error(`Invalid city value "${bar.city}" for bar "${bar.name}"`);
        }
        
        const normalizedBar = { ...bar, city: normalizedCity };
        const key = `${normalizedBar.name}-${normalizedBar.city}`.toLowerCase();
        merged.set(key, normalizedBar);
    });
    
    // Add local bars, only if not already present, with normalized city names
    localBars.forEach(bar => {
        // Only normalize city if it's a real city name, not a URL
        let normalizedCity = bar.city;
        if (bar.city && bar.city.trim() !== '' && !bar.city.startsWith('http')) {
            normalizedCity = normalizeCityName(bar.city);
        } else {
            throw new Error(`Invalid city value "${bar.city}" for bar "${bar.name}"`);
        }
        
        const normalizedBar = { ...bar, city: normalizedCity };
        const key = `${normalizedBar.name}-${normalizedBar.city}`.toLowerCase();
        if (!merged.has(key)) {
            merged.set(key, normalizedBar);
        }
    });
    
    return Array.from(merged.values());
}

// Clean up bar object by removing empty fields
function cleanBarObject(bar) {
    const cleaned = {};
    
    // Keep only fields that have values
    const fieldsToKeep = ['name', 'city', 'address', 'coordinates', 'website', 'instagram', 'facebook', 'googleMaps', 'image', 'wikipedia', 'gayCities'];
    
    fieldsToKeep.forEach(field => {
        if (bar[field] && bar[field].toString().trim() !== '') {
            cleaned[field] = bar[field];
        }
    });
    
    return cleaned;
}

// Check if a bar needs Wikipedia scraping based on missing data or URL changes
function shouldScrapeWikipediaBar(bar, localBar) {
    const missingFields = [];
    
    if (!bar.address || bar.address.trim() === '') missingFields.push('address');
    if (!bar.coordinates || bar.coordinates.trim() === '') missingFields.push('coordinates');
    if (!bar.image || bar.image.trim() === '') missingFields.push('image');
    
    // Check if URL changed from what we have saved locally
    if (bar.wikipedia && localBar?.wikipedia && bar.wikipedia !== localBar.wikipedia) {
        console.log(`🔄 ${bar.name} Wikipedia URL changed: ${localBar.wikipedia} → ${bar.wikipedia}`);
        return true;
    }
    
    if (missingFields.length > 0) {
        console.log(`📋 ${bar.name} missing Wikipedia scrapable fields: ${missingFields.join(', ')}`);
        return true;
    }
    
    return false;
}

// Check if a bar needs GayCities scraping based on missing data or URL changes
function shouldScrapeGayCitiesBar(bar, localBar) {
    const missingFields = [];
    
    if (!bar.address || bar.address.trim() === '') missingFields.push('address');
    if (!bar.coordinates || bar.coordinates.trim() === '') missingFields.push('coordinates');
    if (!bar.website || bar.website.trim() === '') missingFields.push('website');
    if (!bar.instagram || bar.instagram.trim() === '') missingFields.push('instagram');
    if (!bar.facebook || bar.facebook.trim() === '') missingFields.push('facebook');
    if (!bar.googleMaps || bar.googleMaps.trim() === '') missingFields.push('googleMaps');
    
    // Check if URL changed from what we have saved locally
    if (bar.gayCities && localBar?.gayCities && bar.gayCities !== localBar.gayCities) {
        console.log(`🔄 ${bar.name} GayCities URL changed: ${localBar.gayCities} → ${bar.gayCities}`);
        return true;
    }
    
    if (missingFields.length > 0) {
        console.log(`📋 ${bar.name} missing GayCities scrapable fields: ${missingFields.join(', ')}`);
        return true;
    }
    
    return false;
}

// Enrich bars with data from Wikipedia and GayCities fields
async function enrichBarsWithExternalData(bars) {
    const enrichedBars = [];
    
    for (const bar of bars) {
        let enrichedBar = { ...bar };
        
        // Clean up the bar object by removing empty fields
        enrichedBar = cleanBarObject(enrichedBar);
        
        // Find the original local bar data for URL comparison
        const localBar = await findLocalBar(bar.name, bar.city);
        
        // Check if bar needs Wikipedia scraping
        const needsWikipediaScraping = bar.wikipedia && shouldScrapeWikipediaBar(bar, localBar);
        
        // Check if bar needs GayCities scraping
        const needsGayCitiesScraping = bar.gayCities && shouldScrapeGayCitiesBar(bar, localBar);
        
        if (needsWikipediaScraping) {
            try {
                console.log(`🔍 Scraping Wikipedia data for ${bar.name} from ${bar.wikipedia}`);
                const scrapedData = await scrapeWikipediaData(bar.wikipedia);
                
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
                if (!enrichedBar.image && scrapedData.image) {
                    enrichedBar.image = scrapedData.image;
                }
                
                console.log(`✅ Enriched ${bar.name} with Wikipedia data`);
            } catch (error) {
                console.warn(`⚠️  Failed to scrape Wikipedia data for ${bar.name}:`, error.message);
            }
        } else if (needsGayCitiesScraping) {
            try {
                console.log(`🔍 Scraping GayCities data for ${bar.name} from ${bar.gayCities}`);
                const scrapedData = await scrapeGayCitiesData(bar.gayCities);
                
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
                if (!enrichedBar.instagram && scrapedData.instagram) {
                    enrichedBar.instagram = scrapedData.instagram;
                }
                if (!enrichedBar.facebook && scrapedData.facebook) {
                    enrichedBar.facebook = scrapedData.facebook;
                }
                if (!enrichedBar.googleMaps && scrapedData.googleMaps) {
                    enrichedBar.googleMaps = scrapedData.googleMaps;
                }
                
                console.log(`✅ Enriched ${bar.name} with GayCities data`);
            } catch (error) {
                console.warn(`⚠️  Failed to scrape GayCities data for ${bar.name}:`, error.message);
            }
        } else if (bar.wikipedia) {
            console.log(`⏭️  Skipping Wikipedia scraping for ${bar.name} - already has valid data`);
        } else if (bar.gayCities) {
            console.log(`⏭️  Skipping GayCities scraping for ${bar.name} - already has valid data`);
        }
        
        enrichedBars.push(enrichedBar);
    }
    
    return enrichedBars;
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

// Scrape Wikipedia data for a bar (simplified version)
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
    
    const data = {
        address: '',
        coordinates: '',
        website: '',
        image: ''
    };
    
    // Extract address from infobox
    let addressMatch = html.match(/<th[^>]*scope="row"[^>]*class="infobox-label"[^>]*>Address[^>]*<\/th>\s*<td[^>]*class="infobox-data[^"]*"[^>]*>([^<]+)<\/td>/i);
    if (!addressMatch) {
        addressMatch = html.match(/<th[^>]*>Address[^>]*<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
    }
    if (addressMatch) {
        let address = addressMatch[1].trim();
        address = address.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        data.address = address;
    }
    
    // Extract coordinates from infobox
    let coordMatch = html.match(/<span[^>]*class="geo"[^>]*>([^<]+)<\/span>/i);
    if (coordMatch) {
        const coordText = coordMatch[1].trim();
        if (coordText.includes('°N') || coordText.includes('°S') || coordText.includes('°E') || coordText.includes('°W')) {
            data.coordinates = convertDMSToDecimal(coordText);
        } else {
            const cleanCoords = coordText.replace(/[^\d.,\-\s;]/g, '').trim();
            if (cleanCoords.includes(',')) {
                data.coordinates = cleanCoords;
            } else if (cleanCoords.includes(';')) {
                data.coordinates = cleanCoords.replace(';', ',');
            }
        }
    }
    
    // Extract website from infobox
    let websiteMatch = html.match(/Website.*?<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!websiteMatch) {
        websiteMatch = html.match(/<th[^>]*>Website[^>]*<\/th>\s*<td[^>]*><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/i);
    }
    if (websiteMatch) {
        data.website = websiteMatch[1].trim();
    }
    
    // Wikipedia logo extraction removed - logos are now handled by the image download action
    
    return data;
}

// Scrape GayCities data for a bar (simplified version)
async function scrapeGayCitiesData(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; BarDataScraper/1.0)'
        }
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    
    const data = {
        address: '',
        coordinates: '',
        website: '',
        instagram: '',
        facebook: '',
        googleMaps: ''
    };
    
    // Extract address using structured data
    const streetAddress = html.match(/<span[^>]*itemprop="streetAddress"[^>]*>([^<]+)<\/span>/);
    const addressLocality = html.match(/<span[^>]*itemprop="addressLocality"[^>]*>([^<]+)<\/span>/);
    const addressRegion = html.match(/<span[^>]*itemprop="addressRegion"[^>]*>([^<]+)<\/span>/);
    const postalCode = html.match(/<span[^>]*itemprop="postalCode"[^>]*>([^<]+)<\/span>/);
    
    if (streetAddress) {
        let address = streetAddress[1].trim();
        if (addressLocality) {
            address += ', ' + addressLocality[1].trim();
        }
        if (addressRegion) {
            address += ', ' + addressRegion[1].trim();
        }
        if (postalCode) {
            address += ' ' + postalCode[1].trim();
        }
        data.address = address;
    }
    
    // Extract coordinates from JavaScript code
    const latMatch = html.match(/lat:\s*([0-9.-]+)/i);
    const lngMatch = html.match(/lng:\s*([0-9.-]+)/i);
    if (latMatch && lngMatch) {
        data.coordinates = `${latMatch[1]}, ${lngMatch[1]}`;
    }
    
    // Extract website - only if there's a clear "Website" label or in contact section
    let websiteMatch = html.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>.*?Website.*?<\/a>/i);
    if (!websiteMatch) {
        // Look for website in contact/social media sections specifically
        websiteMatch = html.match(/<div[^>]*class="[^"]*contact[^"]*"[^>]*>.*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
    }
    if (!websiteMatch) {
        // Look for website in social media sections
        websiteMatch = html.match(/<div[^>]*class="[^"]*social[^"]*"[^>]*>.*?<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
    }
    
    if (websiteMatch && isValidWebsiteUrl(websiteMatch[1])) {
        data.website = websiteMatch[1].trim();
    }
    
    // Debug: log what we found for website
    if (data.website) {
        console.log(`    📍 Found website: ${data.website}`);
    }
    
    // Extract Instagram - look for specific Instagram profile links (not GayCities' own)
    let instagramMatch = html.match(/<a[^>]*href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"[^>]*>/i);
    if (!instagramMatch) {
        // Look for Instagram links in social media sections
        instagramMatch = html.match(/Instagram[^>]*<a[^>]*href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"/i);
    }
    if (instagramMatch && isValidBarSocialLink(instagramMatch[1], 'instagram')) {
        data.instagram = instagramMatch[1].trim();
    }
    
    // Extract Facebook - look for specific Facebook page links (not GayCities' own)
    let facebookMatch = html.match(/<a[^>]*href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"[^>]*>/i);
    if (!facebookMatch) {
        // Look for Facebook links in social media sections
        facebookMatch = html.match(/Facebook[^>]*<a[^>]*href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"/i);
    }
    if (facebookMatch && isValidBarSocialLink(facebookMatch[1], 'facebook')) {
        let facebookUrl = facebookMatch[1].trim();
        // Fix double URLs (remove duplicate facebook.com)
        if (facebookUrl.includes('https://www.facebook.com/https://www.facebook.com/')) {
            facebookUrl = facebookUrl.replace('https://www.facebook.com/https://www.facebook.com/', 'https://www.facebook.com/');
        }
        data.facebook = facebookUrl;
    }
    
    // Extract Google Maps - look for specific Google Maps links
    let googleMapsMatch = html.match(/<a[^>]*href="(https?:\/\/(?:www\.)?google\.com\/maps\/[^"]+)"[^>]*>/i);
    if (!googleMapsMatch) {
        // Look for Google Maps in location/contact sections
        googleMapsMatch = html.match(/Google Maps[^>]*<a[^>]*href="(https?:\/\/(?:www\.)?google\.com\/maps\/[^"]+)"/i);
    }
    if (googleMapsMatch) {
        data.googleMaps = googleMapsMatch[1].trim();
    } else if (data.address && data.coordinates) {
        // Generate Google Maps URL if we have address and coordinates
        const [lat, lng] = data.coordinates.split(', ');
        const placeName = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const name = placeName ? placeName[1].trim() : 'Bar';
        const encodedName = encodeURIComponent(name);
        const encodedAddress = encodeURIComponent(data.address);
        data.googleMaps = `https://www.google.com/maps/place/${encodedName},+${encodedAddress}/@${lat},${lng},16z/data=!4m6!3m5!1s0x0:0x0!8m2!3d${lat}!4d${lng}!16s%2Fm%2F0k1cf07?g_ep=Eg1tbF8yMDI1MTAxNV8wIJvbDyoASAJQAg%3D%3D`;
    }
    
    return data;
}

// Helper function to validate if a URL is a legitimate website (not social media, tracking, etc.)
function isValidWebsiteUrl(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        
        // Exclude social media platforms, tracking domains, and internal GayCities links
        const excludedDomains = [
            'gaycities.com',
            'facebook.com',
            'instagram.com',
            'twitter.com',
            'x.com',
            'tiktok.com',
            'youtube.com',
            'threads.com',
            'google.com',
            'googleapis.com',
            'googletagmanager.com',
            'google-analytics.com',
            'facebook.net',
            'doubleclick.net',
            'googlesyndication.com',
            'amazon.com',
            'amazonaws.com',
            'cloudfront.net',
            'imgix.net',
            '4sqi.net',
            'foursquare.com',
            'iglta.org',  // This was showing up incorrectly
            'q.digital'   // Another incorrect link
        ];
        
        // Check if hostname contains any excluded domains
        for (const domain of excludedDomains) {
            if (hostname.includes(domain)) {
                return false;
            }
        }
        
        // Must be http or https
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
            return false;
        }
        
        // Must have a valid domain (not just a path)
        if (hostname.length < 3 || !hostname.includes('.')) {
            return false;
        }
        
        // Exclude social media profile URLs (they should be in their own fields)
        const path = urlObj.pathname.toLowerCase();
        if (path.includes('/@') || path.includes('/user/') || path.includes('/profile/')) {
            return false;
        }
        
        return true;
    } catch (e) {
        return false;
    }
}

// Helper function to check if social media links are actually for the bar (not GayCities)
function isValidBarSocialLink(url, platform) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        
        // Must be the correct platform
        if (platform === 'instagram' && !hostname.includes('instagram.com')) return false;
        if (platform === 'facebook' && !hostname.includes('facebook.com')) return false;
        
        // Exclude GayCities' own social media accounts
        const path = urlObj.pathname.toLowerCase();
        if (path.includes('gaycities') || path.includes('gay-cities')) {
            return false;
        }
        
        return true;
    } catch (e) {
        return false;
    }
}

// Convert DMS coordinates to decimal degrees
function convertDMSToDecimal(dms) {
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
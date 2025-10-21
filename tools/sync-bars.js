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

// Enrich bars with data from importUrl (Wikipedia and GayCities scraping)
async function enrichBarsWithImportUrl(bars) {
    const enrichedBars = [];
    
    for (const bar of bars) {
        let enrichedBar = { ...bar };
        
        // Add image field if it doesn't exist
        if (!enrichedBar.image) {
            enrichedBar.image = '';
        }
        
        // Check if bar needs scraping - only scrape if missing data that would be scraped
        const needsWikipediaScraping = bar.importUrl && 
            (bar.importUrl.includes('wikipedia.org') || bar.importUrl.includes('en.wikipedia.org')) &&
            shouldScrapeBar(bar);
        
        const needsGayCitiesScraping = bar.importUrl && 
            bar.importUrl.includes('gaycities.com') &&
            shouldScrapeGayCitiesBar(bar);
        
        if (needsWikipediaScraping) {
            try {
                console.log(`🔍 Scraping Wikipedia data for ${bar.name} from ${bar.importUrl}`);
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
                
                console.log(`✅ Enriched ${bar.name} with Wikipedia data`);
            } catch (error) {
                console.warn(`⚠️  Failed to scrape Wikipedia data for ${bar.name}:`, error.message);
            }
        } else if (needsGayCitiesScraping) {
            try {
                console.log(`🔍 Scraping GayCities data for ${bar.name} from ${bar.importUrl}`);
                const scrapedData = await scrapeGayCitiesData(bar.importUrl);
                
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
                if (!enrichedBar.image && scrapedData.image) {
                    enrichedBar.image = scrapedData.image;
                }
                
                console.log(`✅ Enriched ${bar.name} with GayCities data`);
            } catch (error) {
                console.warn(`⚠️  Failed to scrape GayCities data for ${bar.name}:`, error.message);
            }
        } else if (bar.importUrl && (bar.importUrl.includes('wikipedia.org') || bar.importUrl.includes('en.wikipedia.org'))) {
            console.log(`⏭️  Skipping Wikipedia scraping for ${bar.name} - already has valid data`);
        } else if (bar.importUrl && bar.importUrl.includes('gaycities.com')) {
            console.log(`⏭️  Skipping GayCities scraping for ${bar.name} - already has valid data`);
        }
        
        enrichedBars.push(enrichedBar);
    }
    
    return enrichedBars;
}

// Check if a bar needs scraping based on missing data
function shouldScrapeBar(bar) {
    // Only scrape if we're missing data that Wikipedia can actually provide
    // Based on testing, Wikipedia scraping works for: address, coordinates, image
    // It doesn't reliably work for: website, nickname
    const missingFields = [];
    
    if (!bar.address || bar.address.trim() === '') missingFields.push('address');
    if (!bar.coordinates || bar.coordinates.trim() === '') missingFields.push('coordinates');
    if (!bar.image || bar.image.trim() === '') missingFields.push('image');
    
    const needsScraping = missingFields.length > 0;
    
    if (needsScraping) {
        console.log(`📋 ${bar.name} missing Wikipedia scrapable fields: ${missingFields.join(', ')}`);
    }
    
    return needsScraping;
}

// Check if a bar needs GayCities scraping based on missing data
function shouldScrapeGayCitiesBar(bar) {
    // Only scrape if we're missing data that GayCities can provide
    // GayCities scraping works for: address, coordinates, website, instagram, facebook, googleMaps
    const missingFields = [];
    
    if (!bar.address || bar.address.trim() === '') missingFields.push('address');
    if (!bar.coordinates || bar.coordinates.trim() === '') missingFields.push('coordinates');
    if (!bar.website || bar.website.trim() === '') missingFields.push('website');
    if (!bar.instagram || bar.instagram.trim() === '') missingFields.push('instagram');
    if (!bar.facebook || bar.facebook.trim() === '') missingFields.push('facebook');
    if (!bar.googleMaps || bar.googleMaps.trim() === '') missingFields.push('googleMaps');
    
    const needsScraping = missingFields.length > 0;
    
    if (needsScraping) {
        console.log(`📋 ${bar.name} missing GayCities scrapable fields: ${missingFields.join(', ')}`);
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

// Scrape GayCities data for a bar
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
    
    // Parse the HTML to extract data
    const data = {
        address: '',
        coordinates: '',
        website: '',
        instagram: '',
        facebook: '',
        twitter: '',
        googleMaps: '',
        image: ''
    };
    
    // Extract address using structured data (itemprop attributes)
    // Look for all address components individually since the nested structure is complex
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
    
    // Fallback: try other address patterns if structured data not found
    if (!data.address) {
        let addressMatch = html.match(/<div[^>]*class="[^"]*address[^"]*"[^>]*>([^<]+)<\/div>/i);
        if (!addressMatch) {
            addressMatch = html.match(/<span[^>]*class="[^"]*address[^"]*"[^>]*>([^<]+)<\/span>/i);
        }
        if (!addressMatch) {
            addressMatch = html.match(/Address[^>]*>([^<]+)</i);
        }
        if (addressMatch) {
            data.address = addressMatch[1].trim().replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
        }
    }
    
    // Extract coordinates from JavaScript code (lat/lng patterns)
    const latMatch = html.match(/lat:\s*([0-9.-]+)/i);
    const lngMatch = html.match(/lng:\s*([0-9.-]+)/i);
    if (latMatch && lngMatch) {
        data.coordinates = `${latMatch[1]}, ${lngMatch[1]}`;
    } else {
        // Fallback: look for coordinates in data attributes
        const dataLatMatch = html.match(/data-lat="([^"]+)"/i);
        const dataLngMatch = html.match(/data-lng="([^"]+)"/i);
        if (dataLatMatch && dataLngMatch) {
            data.coordinates = `${dataLatMatch[1]}, ${dataLngMatch[1]}`;
        }
    }
    
    // Extract website - look for website links
    let websiteMatch = html.match(/<a[^>]*href="([^"]+)"[^>]*>Website/i);
    if (!websiteMatch) {
        websiteMatch = html.match(/Website[^>]*<a[^>]*href="([^"]+)"/i);
    }
    if (!websiteMatch) {
        // Look for external website links
        websiteMatch = html.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>.*?Website/i);
    }
    if (!websiteMatch) {
        // Look for any external link that's not a social media platform
        const externalLinks = html.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g);
        if (externalLinks) {
            for (const link of externalLinks) {
                const href = link.match(/href="([^"]+)"/);
                if (href && !href[1].includes('gaycities.com') && 
                    !href[1].includes('google.com') && 
                    !href[1].includes('facebook.com') && 
                    !href[1].includes('instagram.com') && 
                    !href[1].includes('x.com') && 
                    !href[1].includes('twitter.com') &&
                    !href[1].includes('4sqi.net') &&
                    !href[1].includes('imgix.net')) {
                    data.website = href[1].trim();
                    break;
                }
            }
        }
    }
    if (websiteMatch) {
        data.website = websiteMatch[1].trim();
    }
    
    // Extract Instagram - look for Instagram links
    let instagramMatch = html.match(/<a[^>]*href="([^"]*instagram[^"]*)"[^>]*>/i);
    if (!instagramMatch) {
        instagramMatch = html.match(/Instagram[^>]*<a[^>]*href="([^"]+)"/i);
    }
    if (!instagramMatch) {
        // Look for Instagram in social media section
        instagramMatch = html.match(/<a[^>]*href="(https?:\/\/[^"]*instagram[^"]*)"[^>]*>/i);
    }
    if (instagramMatch) {
        data.instagram = instagramMatch[1].trim();
    }
    
    // Extract Facebook - look for Facebook links
    let facebookMatch = html.match(/<a[^>]*href="([^"]*facebook[^"]*)"[^>]*>/i);
    if (!facebookMatch) {
        facebookMatch = html.match(/Facebook[^>]*<a[^>]*href="([^"]+)"/i);
    }
    if (!facebookMatch) {
        // Look for Facebook in social media section
        facebookMatch = html.match(/<a[^>]*href="(https?:\/\/[^"]*facebook[^"]*)"[^>]*>/i);
    }
    if (facebookMatch) {
        data.facebook = facebookMatch[1].trim();
    }
    
    // Extract Twitter/X - look for Twitter/X links
    let twitterMatch = html.match(/<a[^>]*href="([^"]*x\.com[^"]*)"[^>]*>/i);
    if (!twitterMatch) {
        twitterMatch = html.match(/<a[^>]*href="([^"]*twitter[^"]*)"[^>]*>/i);
    }
    if (!twitterMatch) {
        // Look for Twitter/X in social media section
        twitterMatch = html.match(/<a[^>]*href="(https?:\/\/[^"]*x\.com[^"]*)"[^>]*>/i);
    }
    if (twitterMatch) {
        data.twitter = twitterMatch[1].trim();
    }
    
    // Extract Google Maps - look for Google Maps links
    let googleMapsMatch = html.match(/<a[^>]*href="([^"]*google[^"]*maps[^"]*)"[^>]*>/i);
    if (!googleMapsMatch) {
        googleMapsMatch = html.match(/<a[^>]*href="([^"]*maps\.google[^"]*)"[^>]*>/i);
    }
    if (!googleMapsMatch) {
        // Look for Google Maps in location section
        googleMapsMatch = html.match(/<a[^>]*href="(https?:\/\/[^"]*maps\.google[^"]*)"[^>]*>/i);
    }
    if (googleMapsMatch) {
        data.googleMaps = googleMapsMatch[1].trim();
    } else if (data.address && data.coordinates) {
        // Generate a proper Google Maps URL if we have address and coordinates
        const [lat, lng] = data.coordinates.split(', ');
        const placeName = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
        const name = placeName ? placeName[1].trim() : 'Bar';
        const encodedName = encodeURIComponent(name);
        const encodedAddress = encodeURIComponent(data.address);
        data.googleMaps = `https://www.google.com/maps/place/${encodedName},+${encodedAddress}/@${lat},${lng},16z/data=!4m6!3m5!1s0x0:0x0!8m2!3d${lat}!4d${lng}!16s%2Fm%2F0k1cf07?g_ep=Eg1tbF8yMDI1MTAxNV8wIJvbDyoASAJQAg%3D%3D`;
    }
    
    // Extract image - look for bar images
    let imageMatch = html.match(/<img[^>]*src="([^"]*)"[^>]*alt="[^"]*bar[^"]*"[^>]*>/i);
    if (!imageMatch) {
        imageMatch = html.match(/<img[^>]*src="([^"]*)"[^>]*class="[^"]*bar[^"]*"[^>]*>/i);
    }
    if (!imageMatch) {
        // Look for any image in the main content area
        imageMatch = html.match(/<img[^>]*src="([^"]*)"[^>]*class="[^"]*main[^"]*"[^>]*>/i);
    }
    if (!imageMatch) {
        // Look for GayCities listing images (main bar image)
        imageMatch = html.match(/<img[^>]*src="([^"]*gaycities-listing-images[^"]*)"[^>]*>/i);
    }
    if (!imageMatch) {
        // Look for any image with role="presentation" (main content images)
        imageMatch = html.match(/<img[^>]*role="presentation"[^>]*src="([^"]*)"[^>]*>/i);
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

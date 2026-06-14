const fs = require('fs');
const path = require('path');

// Bear Directory Google Sheet ID
const SHEET_ID = '1-ttoHpM6unij08U40voVi8YLn7j8Mhld4FkRsKrzql4';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

const CACHE_FILE = path.join(process.cwd(), 'data', 'microlink', 'directory-cache.json');
const MAX_REQUESTS_PER_RUN = 40;

// Randomize staleness threshold between 30 and 45 days
const getStalenessThresholdMs = () => {
    const days = 30 + Math.floor(Math.random() * 15);
    return days * 24 * 60 * 60 * 1000;
};

// Simple delay function
const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchGoogleSheetsData() {
    console.log(`Fetching directory data from Google Sheets...`);
    const response = await fetch(SHEET_URL);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const text = await response.text();
    const jsonString = text.substring(47).slice(0, -2);
    const json = JSON.parse(jsonString);

    const rows = json.table.rows;
    const data = [];

    // Skip header
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.c || !row.c[0] || !row.c[0].v) continue;

        const name = row.c[0] && row.c[0].v ? row.c[0].v.trim() : '';
        const shop = row.c[1] && row.c[1].v ? row.c[1].v.trim() : '';
        const website = row.c[2] && row.c[2].v ? row.c[2].v.trim() : '';
        const instagram = row.c[3] && row.c[3].v ? row.c[3].v.trim() : '';
        const type = row.c[4] && row.c[4].v ? row.c[4].v.trim() : '';

        // We prefer website or shop first since Microlink is for websites
        const finalUrl = website || shop || (instagram ? `https://instagram.com/${instagram}` : '');

        data.push({ type, name, instagram, website, shop, finalUrl });
    }
    return data;
}

async function fetchMicrolinkData(url) {
    try {
        console.log(`Fetching Microlink for: ${url}`);
        const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
        if (!response.ok) {
            console.warn(`Microlink fetch failed for ${url} with status ${response.status}`);
            return null;
        }
        const json = await response.json();
        if (json.status !== 'success' || !json.data) return null;

        return {
            title: json.data.title,
            description: json.data.description,
            image: json.data.image ? json.data.image.url : (json.data.logo ? json.data.logo.url : null)
        };
    } catch (e) {
        console.error(`Error fetching Microlink for ${url}:`, e);
        return null;
    }
}

async function run() {
    // Ensure directory exists
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Load existing cache
    let cache = {};
    if (fs.existsSync(CACHE_FILE)) {
        try {
            cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        } catch (e) {
            console.error('Error reading existing cache, starting fresh.', e);
        }
    }

    const items = await fetchGoogleSheetsData();
    let requestsMade = 0;
    let newUpdates = 0;

    // Shuffle items to avoid always checking the same ones first
    const shuffledItems = items.sort(() => 0.5 - Math.random());

    const now = Date.now();

    for (const item of shuffledItems) {
        if (requestsMade >= MAX_REQUESTS_PER_RUN) {
            console.log(`Reached max requests (${MAX_REQUESTS_PER_RUN}) for this run.`);
            break;
        }

        const url = item.finalUrl;
        if (!url) continue;

        // Identify key
        const key = item.name ? item.name.toLowerCase().trim() : url;
        const cachedEntry = cache[key];

        let needsUpdate = false;
        if (!cachedEntry) {
            needsUpdate = true;
        } else if (cachedEntry.url !== url) {
            needsUpdate = true;
        } else {
            const lastFetched = cachedEntry.lastFetched || 0;
            if (now - lastFetched > getStalenessThresholdMs()) {
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            // Introduce a small delay to be polite
            if (requestsMade > 0) await delay(1000);

            const metadata = await fetchMicrolinkData(url);
            requestsMade++;

            if (metadata) {
                cache[key] = {
                    ...metadata,
                    url: url,
                    lastFetched: now
                };
                newUpdates++;
            } else {
                // If it fails, save a placeholder so we don't keep retrying it immediately
                cache[key] = {
                    title: null,
                    description: null,
                    image: null,
                    url: url,
                    lastFetched: now,
                    error: true
                };
            }
        }
    }

    if (newUpdates > 0 || requestsMade > 0) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log(`Cache updated with ${newUpdates} successful new/refreshed entries out of ${requestsMade} requests.`);
    } else {
        console.log('No cache updates needed.');
    }
}

run().catch(console.error);

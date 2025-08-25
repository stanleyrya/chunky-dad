// Debug script to examine actual Eventbrite detail page structure
// We need to find where the pricing data is actually stored

const https = require('https');

async function fetchEventbriteDetailPage() {
    const url = 'https://www.eventbrite.com/e/megawoof-america-las-vegas-labor-day-weekend-bears-at-work-tickets-1531257726079';
    
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'chunky-dad-scraper/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };
        
        https.get(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

function extractJsonObject(html, startIndex) {
    let braceCount = 0;
    let inString = false;
    let i = startIndex;
    
    // Find the opening brace
    while (i < html.length && html[i] !== '{') {
        i++;
    }
    
    if (i >= html.length) {
        return null;
    }
    
    const start = i;
    braceCount = 1;
    i++;
    
    // Track through the JSON to find the matching closing brace
    while (i < html.length && braceCount > 0) {
        const char = html[i];
        
        if (char === '"' && html[i-1] !== '\\') {
            inString = !inString;
        } else if (!inString) {
            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
            }
        }
        i++;
    }
    
    if (braceCount === 0) {
        return html.substring(start, i);
    }
    
    return null;
}

async function debugEventbriteStructure() {
    try {
        console.log('Fetching Eventbrite detail page...');
        const html = await fetchEventbriteDetailPage();
        console.log(`Fetched ${html.length} characters`);
        
        // Find the __SERVER_DATA__
        const startMatch = html.match(/window\.__SERVER_DATA__\s*=\s*/);
        if (!startMatch) {
            console.log('❌ No __SERVER_DATA__ found');
            return;
        }
        
        console.log('✅ Found __SERVER_DATA__');
        const startIndex = startMatch.index + startMatch[0].length;
        const jsonString = extractJsonObject(html, startIndex);
        
        if (!jsonString) {
            console.log('❌ Could not extract JSON object');
            return;
        }
        
        console.log('✅ Extracted JSON object');
        const serverData = JSON.parse(jsonString);
        
        console.log('\n=== TOP LEVEL KEYS ===');
        console.log(Object.keys(serverData));
        
        if (serverData.event_listing_response) {
            console.log('\n=== EVENT_LISTING_RESPONSE KEYS ===');
            console.log(Object.keys(serverData.event_listing_response));
            
            if (serverData.event_listing_response.tickets) {
                console.log('\n=== TICKETS STRUCTURE ===');
                console.log('tickets keys:', Object.keys(serverData.event_listing_response.tickets));
                
                if (serverData.event_listing_response.tickets.ticketClasses) {
                    console.log('ticketClasses found:', serverData.event_listing_response.tickets.ticketClasses.length, 'items');
                    console.log('First ticketClass sample:', JSON.stringify(serverData.event_listing_response.tickets.ticketClasses[0], null, 2));
                } else {
                    console.log('❌ No ticketClasses found in tickets');
                }
            } else {
                console.log('❌ No tickets found in event_listing_response');
            }
        }
        
        if (serverData.components) {
            console.log('\n=== COMPONENTS KEYS ===');
            console.log(Object.keys(serverData.components));
            
            // Look for pricing in various component locations
            const potentialPricingComponents = [
                'eventDetails', 'eventTickets', 'ticketSelection', 'checkout', 
                'pricing', 'ticketList', 'ticketWidget', 'eventInfo'
            ];
            
            potentialPricingComponents.forEach(componentName => {
                if (serverData.components[componentName]) {
                    console.log(`\n=== COMPONENT: ${componentName.toUpperCase()} ===`);
                    console.log('Keys:', Object.keys(serverData.components[componentName]));
                    
                    // Look for anything that might contain pricing
                    const component = serverData.components[componentName];
                    Object.keys(component).forEach(key => {
                        if (key.toLowerCase().includes('price') || 
                            key.toLowerCase().includes('cost') || 
                            key.toLowerCase().includes('ticket') ||
                            key.toLowerCase().includes('fee')) {
                            console.log(`  📍 Found pricing-related key: ${key}`);
                            console.log(`     Value:`, JSON.stringify(component[key], null, 2).substring(0, 200) + '...');
                        }
                    });
                }
            });
        }
        
        console.log('\n=== SEARCHING FOR PRICING PATTERNS ===');
        const jsonStr = JSON.stringify(serverData);
        const pricePatterns = [
            /\$\d+\.\d{2}/g,
            /"price":/g,
            /"cost":/g,
            /"fee":/g,
            /"amount":/g,
            /ticketClass/g
        ];
        
        pricePatterns.forEach((pattern, i) => {
            const matches = jsonStr.match(pattern);
            if (matches) {
                console.log(`Pattern ${i + 1} (${pattern}): ${matches.length} matches`);
                if (i === 0) { // Dollar amounts
                    console.log('  Sample matches:', matches.slice(0, 5));
                }
            }
        });
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

debugEventbriteStructure();
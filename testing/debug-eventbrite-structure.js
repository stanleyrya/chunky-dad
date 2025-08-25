// Debug script to understand Eventbrite data structure issues
// Based on the log analysis from the scraper run

console.log('=== EVENTBRITE COVER PARSING DEBUG ===');

// Simulate the issue based on log data
function debugCoverParsing() {
    console.log('\n1. ORGANIZER PAGE (Working):');
    const organizerEventData = {
        is_free: false,
        price_range: '$11.58 - $27.37',
        inventory_type: 'limited'
    };
    
    let organizerPrice = extractPrice(organizerEventData, null);
    console.log(`   Organizer Price: "${organizerPrice}"`);
    
    console.log('\n2. DETAIL PAGE (Broken):');
    const detailEventData = {
        is_free: false,
        price_range: null, // This is null on detail pages
        inventory_type: null
    };
    
    // The issue: ticketClasses might be missing or structured differently
    const detailServerData = {
        event_listing_response: {
            tickets: {
                ticketClasses: [] // Empty or missing!
            }
        }
    };
    
    let detailPrice = extractPrice(detailEventData, detailServerData);
    console.log(`   Detail Price: "${detailPrice}"`);
    console.log(`   PROBLEM: Detail page returns empty string!`);
    
    console.log('\n3. MERGE RESULT:');
    console.log(`   Original: "${organizerPrice}"`);
    console.log(`   Merged:   "${detailPrice}"`);
    console.log(`   ISSUE: Detail page overwrites good data with empty string!`);
    
    console.log('\n4. POSSIBLE SOLUTIONS:');
    console.log('   A. Fix detail page parsing to find ticket info in different location');
    console.log('   B. Preserve organizer page price when detail page returns empty');
    console.log('   C. Look for alternative price sources in detail pages');
}

function extractPrice(eventData, serverData) {
    let price = '';
    
    if (eventData.is_free) {
        price = 'Free';
    } else if (eventData.price_range) {
        price = eventData.price_range;
        
        if (eventData.inventory_type === 'limited') {
            const now = new Date();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            price += ` (as of ${month}/${day})`;
        }
    } else if (serverData?.event_listing_response?.tickets?.ticketClasses) {
        const ticketClasses = serverData.event_listing_response.tickets.ticketClasses;
        const prices = ticketClasses
            .filter(tc => tc.totalCost && tc.totalCost.display)
            .map(tc => parseFloat(tc.totalCost.majorValue))
            .filter(p => !isNaN(p))
            .sort((a, b) => a - b);
        
        if (prices.length > 0) {
            const minPrice = prices[0];
            const maxPrice = prices[prices.length - 1];
            
            if (minPrice === maxPrice) {
                price = `$${minPrice.toFixed(2)}`;
            } else {
                price = `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;
            }
            
            const now = new Date();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            price += ` (as of ${month}/${day})`;
        }
    }
    
    return price;
}

// Run the debug
debugCoverParsing();

console.log('\n=== RECOMMENDATION ===');
console.log('The issue is that detail pages are not finding ticket pricing information.');
console.log('Need to investigate the actual serverData structure in detail pages');
console.log('and either find the pricing elsewhere or preserve organizer page pricing.');
// Debug why the ticketClasses condition isn't being met

// Simulate the conditions from the parser
function debugConditions() {
    console.log('=== DEBUGGING PARSER CONDITIONS ===');
    
    // Simulate eventData from detail page (what the parser receives)
    const eventData = {
        is_free: false,
        price_range: null, // This is null in detail pages
        inventory_type: null
    };
    
    // Simulate serverData structure from detail page
    const serverData = {
        event_listing_response: {
            tickets: {
                ticketClasses: [
                    {
                        totalCost: {
                            currency: "USD",
                            majorValue: "11.58",
                            display: "11.58 USD"
                        }
                    }
                ]
            }
        }
    };
    
    console.log('\n1. Testing eventData.is_free condition:');
    console.log(`   eventData.is_free = ${eventData.is_free}`);
    console.log(`   Condition met: ${eventData.is_free}`);
    
    console.log('\n2. Testing eventData.price_range condition:');
    console.log(`   eventData.price_range = ${eventData.price_range}`);
    console.log(`   Condition met: ${!!eventData.price_range}`);
    
    console.log('\n3. Testing serverData ticketClasses condition:');
    console.log(`   serverData exists: ${!!serverData}`);
    console.log(`   event_listing_response exists: ${!!serverData?.event_listing_response}`);
    console.log(`   tickets exists: ${!!serverData?.event_listing_response?.tickets}`);
    console.log(`   ticketClasses exists: ${!!serverData?.event_listing_response?.tickets?.ticketClasses}`);
    console.log(`   ticketClasses length: ${serverData?.event_listing_response?.tickets?.ticketClasses?.length}`);
    
    const hasTicketClasses = !!(serverData?.event_listing_response?.tickets?.ticketClasses);
    console.log(`   Full condition result: ${hasTicketClasses}`);
    
    // Simulate the parser logic flow
    let price = '';
    
    if (eventData.is_free) {
        price = 'Free';
        console.log('\n🔄 Taking is_free path');
    } else if (eventData.price_range) {
        price = eventData.price_range;
        console.log('\n🔄 Taking price_range path');
    } else if (serverData?.event_listing_response?.tickets?.ticketClasses) {
        console.log('\n🔄 Taking ticketClasses path');
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
            
            console.log(`   ✅ Extracted price: "${price}"`);
        }
    } else {
        console.log('\n🔄 No pricing conditions met - taking else path');
    }
    
    return price;
}

const result = debugConditions();
console.log(`\n=== FINAL RESULT ===`);
console.log(`Price: "${result}"`);

if (result && result !== '') {
    console.log('✅ Logic should work - issue might be in actual runtime data');
} else {
    console.log('❌ Logic has a problem');
}
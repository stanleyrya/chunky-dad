// Test the ticketClasses parsing logic with the actual data structure

// Simulate the actual ticketClasses data I found
const actualTicketClasses = [
    {
        "totalCost": {
            "currency": "USD",
            "majorValue": "11.58",
            "display": "11.58 USD",
            "value": 1158
        },
        "name": "SPECIAL 10$",
        "onSaleStatusEnum": "SOLD_OUT"
    },
    {
        "totalCost": {
            "currency": "USD", 
            "majorValue": "27.37",
            "display": "27.37 USD",
            "value": 2737
        },
        "name": "GENERAL ADMISSION",
        "onSaleStatusEnum": "ON_SALE"
    },
    {
        "totalCost": {
            "currency": "USD",
            "majorValue": "11.58", 
            "display": "11.58 USD",
            "value": 1158
        },
        "name": "EARLY BIRD",
        "onSaleStatusEnum": "SOLD_OUT"
    }
];

function testTicketClassesParsing() {
    console.log('=== TESTING TICKETCLASSES PARSING ===');
    console.log(`Input: ${actualTicketClasses.length} ticket classes`);
    
    // Simulate the parser logic exactly
    const prices = actualTicketClasses
        .filter(tc => {
            const hasData = tc.totalCost && tc.totalCost.display;
            console.log(`  Ticket "${tc.name}": hasData=${hasData}, totalCost=${JSON.stringify(tc.totalCost)}`);
            return hasData;
        })
        .map(tc => {
            const parsed = parseFloat(tc.totalCost.majorValue);
            console.log(`  Parsing "${tc.totalCost.majorValue}" -> ${parsed}`);
            return parsed;
        })
        .filter(p => {
            const isValid = !isNaN(p);
            console.log(`  Price ${p}: isValid=${isValid}`);
            return isValid;
        })
        .sort((a, b) => a - b);
    
    console.log(`\nFiltered prices: [${prices.join(', ')}]`);
    
    if (prices.length > 0) {
        const minPrice = prices[0];
        const maxPrice = prices[prices.length - 1];
        const currency = actualTicketClasses[0]?.totalCost?.currency || 'USD';
        
        let price;
        if (minPrice === maxPrice) {
            price = `$${minPrice.toFixed(2)}`;
        } else {
            price = `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;
        }
        
        // Add availability hint
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        price += ` (as of ${month}/${day})`;
        
        console.log(`\n✅ RESULT: "${price}"`);
        console.log(`   Expected something like: "$11.58 - $27.37 (as of 8/25)"`);
        
        return price;
    } else {
        console.log('\n❌ RESULT: No prices found');
        return '';
    }
}

// Test with the actual data
const result = testTicketClassesParsing();

console.log('\n=== ANALYSIS ===');
if (result && result !== '') {
    console.log('✅ Parser logic works correctly with actual data');
    console.log('❌ Issue must be elsewhere - maybe serverData structure is different in runtime');
} else {
    console.log('❌ Parser logic has a bug');
}

// Test edge cases
console.log('\n=== TESTING EDGE CASES ===');

// Test with missing totalCost
const brokenTicketClasses = [
    { name: "Broken", totalCost: null },
    { name: "Missing", /* no totalCost */ },
    { name: "Good", totalCost: { majorValue: "10.00", display: "10.00 USD" } }
];

console.log('\nTesting with broken data:');
const brokenPrices = brokenTicketClasses
    .filter(tc => tc.totalCost && tc.totalCost.display)
    .map(tc => parseFloat(tc.totalCost.majorValue))
    .filter(p => !isNaN(p));

console.log(`Broken data result: [${brokenPrices.join(', ')}]`);
console.log(`Should find 1 valid price: ${brokenPrices.length === 1 ? '✅' : '❌'}`);
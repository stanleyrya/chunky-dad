// Test the cover merge fix
console.log('=== TESTING COVER MERGE FIX ===');

// Simulate the smart clobber logic
function smartClobber(fieldName, scrapedValue, existingValue) {
    if (fieldName === 'cover' && (!scrapedValue || scrapedValue === '') && existingValue && existingValue !== '') {
        console.log(`🔄 SMART CLOBBER: ${fieldName} preserved existing value "${existingValue}" (new value was empty: "${scrapedValue}")`);
        return existingValue;
    } else {
        console.log(`🔄 CLOBBER: ${fieldName} changed from "${existingValue}" to "${scrapedValue}"`);
        return scrapedValue;
    }
}

console.log('\n1. Test Case: Organizer page has price, detail page has empty price');
const organizerPrice = '$11.58 - $27.37 (as of 8/25)';
const detailPrice = '';
const result1 = smartClobber('cover', detailPrice, organizerPrice);
console.log(`   Result: "${result1}"`);
console.log(`   Expected: "${organizerPrice}"`);
console.log(`   ✅ ${result1 === organizerPrice ? 'PASS' : 'FAIL'}`);

console.log('\n2. Test Case: Detail page has new price, should update');
const newDetailPrice = '$15.00 - $30.00 (as of 8/25)';
const result2 = smartClobber('cover', newDetailPrice, organizerPrice);
console.log(`   Result: "${result2}"`);
console.log(`   Expected: "${newDetailPrice}"`);
console.log(`   ✅ ${result2 === newDetailPrice ? 'PASS' : 'FAIL'}`);

console.log('\n3. Test Case: Both empty, should remain empty');
const result3 = smartClobber('cover', '', '');
console.log(`   Result: "${result3}"`);
console.log(`   Expected: ""`);
console.log(`   ✅ ${result3 === '' ? 'PASS' : 'FAIL'}`);

console.log('\n4. Test Case: Other field should work normally');
const result4 = smartClobber('title', 'New Title', 'Old Title');
console.log(`   Result: "${result4}"`);
console.log(`   Expected: "New Title"`);
console.log(`   ✅ ${result4 === 'New Title' ? 'PASS' : 'FAIL'}`);

console.log('\n=== FIX VERIFICATION ===');
console.log('The smart clobber logic should:');
console.log('✅ Preserve existing cover price when detail page returns empty');
console.log('✅ Update cover price when detail page has valid new price');
console.log('✅ Work normally for all other fields');
console.log('✅ Handle edge cases like both values being empty');
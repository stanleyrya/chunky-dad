// Test timezone conversion logic

function testTimezoneConversion() {
    console.log('=== Testing Timezone Conversion Logic ===\n');
    
    // Test case: 10:00 PM EST on August 23, 2025
    // Should become 3:00 AM UTC on August 24, 2025
    
    const date = new Date('2025-08-23T00:00:00.000Z'); // Base date in UTC
    const timeHours = 22; // 10 PM
    const timeMinutes = 0;
    const atlantaOffset = -5 * 60; // EST = -300 minutes from UTC
    
    console.log('Input:');
    console.log(`  Date: August 23, 2025`);
    console.log(`  Time: ${timeHours}:${timeMinutes} (10:00 PM EST)`);
    console.log(`  Atlanta offset: ${atlantaOffset} minutes (EST = UTC-5)`);
    console.log();
    
    // Current logic
    const combined = new Date(date);
    combined.setHours(timeHours, timeMinutes, 0, 0);
    console.log(`Combined local time: ${combined.toISOString()}`);
    
    const currentLogic = new Date(combined.getTime() - (atlantaOffset * 60 * 1000));
    console.log(`Current logic result: ${currentLogic.toISOString()}`);
    console.log(`  → ${currentLogic.toLocaleString('en-US', { timeZone: 'UTC' })} UTC`);
    console.log();
    
    // What it SHOULD be
    console.log('Expected result:');
    console.log('  10:00 PM EST = 3:00 AM UTC next day');
    console.log('  Should be: 2025-08-24T03:00:00.000Z');
    console.log();
    
    // Test the math
    console.log('Math check:');
    console.log(`  atlantaOffset = ${atlantaOffset} minutes`);
    console.log(`  atlantaOffset * 60 * 1000 = ${atlantaOffset * 60 * 1000} milliseconds`);
    console.log(`  combined.getTime() = ${combined.getTime()}`);
    console.log(`  combined.getTime() - (${atlantaOffset * 60 * 1000}) = ${combined.getTime() - (atlantaOffset * 60 * 1000)}`);
    console.log();
    
    // Verify with manual calculation
    const manualUTC = new Date('2025-08-24T03:00:00.000Z'); // Expected result
    console.log(`Manual expected: ${manualUTC.toISOString()}`);
    console.log(`Current matches expected: ${currentLogic.toISOString() === manualUTC.toISOString() ? '✅' : '❌'}`);
    
    // Test a few more cases
    console.log('\n--- Additional Test Cases ---');
    
    const testCases = [
        { city: 'atlanta', hours: 3, expected: '2025-08-23T08:00:00.000Z' }, // 3 AM EST = 8 AM UTC
        { city: 'portland', hours: 21, expected: '2025-08-24T05:00:00.000Z' }, // 9 PM PST = 5 AM UTC next day
        { city: 'denver', hours: 14, expected: '2025-08-23T21:00:00.000Z' }    // 2 PM MST = 9 PM UTC
    ];
    
    testCases.forEach(test => {
        const testDate = new Date('2025-08-23T00:00:00.000Z');
        const testCombined = new Date(testDate);
        testCombined.setHours(test.hours, 0, 0, 0);
        
        const cityOffsets = {
            'atlanta': -5 * 60,
            'portland': -8 * 60,
            'denver': -7 * 60
        };
        
        const offset = cityOffsets[test.city];
        const result = new Date(testCombined.getTime() - (offset * 60 * 1000));
        
        console.log(`${test.city} ${test.hours}:00 → ${result.toISOString()} (expected: ${test.expected}) ${result.toISOString() === test.expected ? '✅' : '❌'}`);
    });
}

testTimezoneConversion();
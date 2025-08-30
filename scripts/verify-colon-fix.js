// Test to verify colon escaping fix
const fs = require('fs');

// Read and evaluate the shared-core.js file
const sharedCoreCode = fs.readFileSync('shared-core.js', 'utf8');

// Extract just the class definition and methods we need
const classMatch = sharedCoreCode.match(/class SharedCore \{[\s\S]*?\n\}/);
if (!classMatch) {
    console.error('Could not find SharedCore class');
    process.exit(1);
}

// Create a minimal test environment
eval(`
${classMatch[0]}

// Test the escaping with a realistic event description
const core = new SharedCore();

// Test event with colons in description
const testEvent = {
    title: 'Test Event',
    description: 'Doors open at 9:30 PM. Show starts at 10:00 PM. Party until 2:00 AM.',
    bar: 'Test Venue',
    address: '123 Main St',
    cover: '$20 - $30'
};

console.log('=== COLON ESCAPING TEST ===');
console.log('Original event description:', testEvent.description);

// Format notes (this should escape colons)
const notes = core.formatEventNotes(testEvent);
console.log('\\nFormatted notes:');
console.log(notes);

// Parse notes back (this should unescape colons)
const parsedFields = core.parseNotesIntoFields(notes);
console.log('\\nParsed back description:', parsedFields.description);

// Verify round-trip
const success = parsedFields.description === testEvent.description;
console.log('\\nRound-trip test:', success ? '✅ PASSED' : '❌ FAILED');

if (!success) {
    console.log('Expected:', testEvent.description);
    console.log('Got:', parsedFields.description);
}

// Test with the problematic log example
const logExample = 'LONG BEACH — WE\\'RE BACK! \\n The bears of MEGAWOOF \\nreturn to close out the Summer Tour in you —\\nSATURDAY, AUGUST 30th  and it\\'s all goin';
const logEvent = {
    title: 'MEGAWOOF',
    description: logExample,
    bar: 'Falcon North'
};

console.log('\\n=== LOG EXAMPLE TEST ===');
const logNotes = core.formatEventNotes(logEvent);
const logParsed = core.parseNotesIntoFields(logNotes);
const logSuccess = logParsed.description === logExample;
console.log('Log round-trip test:', logSuccess ? '✅ PASSED' : '❌ FAILED');

console.log('\\n=== SUMMARY ===');
console.log('All tests passed:', success && logSuccess ? '✅ YES' : '❌ NO');
`);
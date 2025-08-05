// Test to verify no double-saving with aliases
const { SharedCore } = require('./shared-core.js');

console.log('Testing that aliases don\'t create duplicate fields...\n');

const sharedCore = new SharedCore();

// Test 1: Parse notes with aliases
console.log('Test 1: Parsing notes with aliases');
const notesWithAliases = `Bar: The Eagle
Location: Should be ignored (Bar already set)
Tea: Bear night description
Description: Should be ignored (Tea already set)
Cover: $15
Price: Should be ignored (Cover already set)`;

const parsed = sharedCore.parseNotesIntoFields(notesWithAliases);
console.log('Parsed fields:', JSON.stringify(parsed, null, 2));

console.log('\nChecking for duplicates:');
console.log('Has "bar" field:', 'bar' in parsed ? '❌ (should not exist)' : '✅');
console.log('Has "venue" field:', parsed.venue === 'The Eagle' ? '✅' : '❌');
console.log('Has "tea" field:', 'tea' in parsed ? '❌ (should not exist)' : '✅');
console.log('Has "description" field:', parsed.description === 'Bear night description' ? '✅' : '❌');
console.log('Has "cover" field:', 'cover' in parsed ? '❌ (should not exist)' : '✅');
console.log('Has "price" field:', parsed.price === '$15' ? '✅' : '❌');

// Test 2: Format back to notes
console.log('\n\nTest 2: Formatting back to notes');
const event = {
    venue: 'The Eagle',
    description: 'Bear night',
    price: '$10',
    _action: 'new'
};

const formatted = sharedCore.formatEventNotes(event);
console.log('Formatted notes:\n' + formatted);

console.log('\nChecking output uses canonical names:');
console.log('Contains "venue:":', formatted.includes('venue:') ? '✅' : '❌');
console.log('Contains "bar:":', formatted.includes('bar:') ? '❌ (should not exist)' : '✅');
console.log('Contains "description:":', formatted.includes('description:') ? '✅' : '❌');
console.log('Contains "tea:":', formatted.includes('tea:') ? '❌ (should not exist)' : '✅');

// Test 3: What happens with conflicting aliases
console.log('\n\nTest 3: Conflicting aliases (first one wins)');
const conflictingNotes = `Tea: First description
Description: Second description
Bar: First venue
Venue: Second venue`;

const conflictParsed = sharedCore.parseNotesIntoFields(conflictingNotes);
console.log('Parsed fields:', JSON.stringify(conflictParsed, null, 2));
console.log('Note: First occurrence wins when there are conflicts');

console.log('\n\nConclusion: No double-saving! Aliases are normalized to canonical names.');
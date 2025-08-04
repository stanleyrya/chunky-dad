// Test script to verify field handling consistency
const { SharedCore } = require('./shared-core');
const { ScriptableAdapter } = require('./adapters/scriptable-adapter');

// Create a test event with all possible fields
const testEvent = {
    title: 'Test Event',
    shortTitle: 'Test',
    shortName: 'TST',
    shorterName: 'T',
    description: 'This is a test event description',
    tea: 'Alternative description field',
    venue: 'Test Venue',
    bar: 'Test Bar',
    city: 'nyc',
    startDate: new Date('2024-02-01T20:00:00'),
    endDate: new Date('2024-02-01T23:00:00'),
    day: 'Friday',
    time: '8:00 PM',
    price: '$10',
    instagram: 'https://instagram.com/test',
    website: 'https://test.com',
    googleMapsLink: 'https://maps.google.com/test',
    gmaps: 'https://goo.gl/maps/test',
    key: 'test-event-key',
    source: 'test-parser',
    eventType: 'party',
    type: 'bear-party',
    recurrence: 'weekly',
    recurring: true,
    timezone: 'America/New_York',
    coordinates: '40.7128,-74.0060',
    slug: 'test-event',
    isBearEvent: true,
    image: 'https://test.com/image.jpg',
    links: ['https://link1.com', 'https://link2.com'],
    _original: {
        new: {
            title: 'New Title',
            description: 'New description',
            shortName: 'NEW',
            venue: 'New Venue',
            tea: 'New tea field'
        },
        existing: {
            title: 'Existing Title',
            description: 'Existing description',
            shortName: 'OLD',
            venue: 'Existing Venue'
        }
    },
    _fieldMergeStrategies: {
        title: 'preserve',
        description: 'clobber',
        shortName: 'upsert',
        venue: 'clobber',
        bar: 'clobber',
        tea: 'upsert',
        instagram: 'upsert',
        googleMapsLink: 'upsert'
    },
    _action: 'merge' // Not 'new', so strategies matter
};

console.log('Testing Field Display Consistency\n');
console.log('=================================\n');

// Test 1: Check all fields are in EVENT_FIELDS
console.log('1. Checking if all event fields are defined in EVENT_FIELDS:');
const eventFields = Object.keys(testEvent).filter(k => !k.startsWith('_'));
const definedFields = SharedCore.getAllFieldNames();
const missingFields = eventFields.filter(f => !definedFields.includes(f));

if (missingFields.length === 0) {
    console.log('✅ All fields are defined');
} else {
    console.log('❌ Missing fields:', missingFields);
}

// Test 2: Generate comparison rows
console.log('\n2. Testing generateComparisonRows:');
const adapter = new ScriptableAdapter();
const comparisonHTML = adapter.generateComparisonRows(testEvent);

// Check if key fields are present in the output
const fieldsToCheck = ['description', 'tea', 'shortName', 'shortTitle', 'venue'];
console.log('\nChecking if fields appear in comparison display:');
fieldsToCheck.forEach(field => {
    const fieldDisplay = SharedCore.getFieldDisplayName(field);
    if (comparisonHTML.includes(fieldDisplay)) {
        console.log(`✅ ${field} (${fieldDisplay}) - found in display`);
    } else {
        console.log(`❌ ${field} (${fieldDisplay}) - NOT found in display`);
    }
});

// Test 3: Check calendar notes formatting
console.log('\n3. Testing buildCalendarEventNotes:');
const sharedCore = new SharedCore();
const notes = sharedCore.buildCalendarEventNotes(testEvent);
console.log('\nGenerated notes:');
console.log('----------------');
console.log(notes);
console.log('----------------');

// Check if fields are in notes
console.log('\nChecking if fields appear in notes:');
const noteFieldsToCheck = ['Short Name', 'Description', 'Bar', 'Instagram', 'Google Maps'];
noteFieldsToCheck.forEach(field => {
    if (notes.includes(field + ':')) {
        console.log(`✅ ${field} - found in notes`);
    } else {
        console.log(`❌ ${field} - NOT found in notes`);
    }
});

console.log('\n✅ Test complete!');
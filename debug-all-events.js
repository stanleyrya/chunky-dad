// Debug script to show all events with recurrence ID
const fs = require('fs');

// Mock the logger for Node.js environment
global.logger = {
    componentInit: () => {},
    componentLoad: () => {},
    componentError: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    time: () => {},
    timeEnd: () => {},
    apiCall: () => {}
};

// Load the calendar core
const CalendarCore = require('./js/calendar-core.js');

async function debugAllEvents() {
    try {
        console.log('🔍 Debugging all events with recurrence ID...\n');
        
        // Create a calendar core instance
        const calendarCore = new CalendarCore();
        
        // Read the NYC calendar data
        const icalData = fs.readFileSync('data/calendars/new-york.ics', 'utf8');
        
        // Parse the calendar data
        const events = calendarCore.parseICalData(icalData);
        
        console.log(`📊 Total events parsed: ${events.length}`);
        
        // Show all events with their recurrence ID
        events.forEach((event, index) => {
            console.log(`\n--- Event ${index + 1} ---`);
            console.log(`Name: ${event.name}`);
            console.log(`Date: ${event.startDate ? event.startDate.toISOString().split('T')[0] : 'N/A'}`);
            console.log(`Recurring: ${event.recurring ? 'Yes' : 'No'}`);
            console.log(`Recurrence: ${event.recurrence || 'N/A'}`);
            console.log(`Recurrence ID: ${event.recurrenceId ? event.recurrenceId.toISOString().split('T')[0] : 'N/A'}`);
            console.log(`UID: ${event.uid || 'N/A'}`);
            
            // Check if this is a merged event
            if (event.getEffectiveDataForDate) {
                console.log(`✅ This is a merged event with exception handling`);
            } else {
                console.log(`❌ This is NOT a merged event`);
            }
        });
        
        // Find GOLDILOXX events specifically
        const goldiloxxEvents = events.filter(event => 
            event.name && event.name.toLowerCase().includes('goldiloxx')
        );
        
        console.log(`\n🎭 GOLDILOXX events found: ${goldiloxxEvents.length}`);
        
        if (goldiloxxEvents.length === 2) {
            console.log('✅ Found both GOLDILOXX events - deduplication should work');
        } else if (goldiloxxEvents.length === 1) {
            console.log('⚠️ Only found one GOLDILOXX event - deduplication may have already worked');
        } else {
            console.log(`❌ Unexpected number of GOLDILOXX events: ${goldiloxxEvents.length}`);
        }
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error(error.stack);
    }
}

// Run the debug
debugAllEvents();
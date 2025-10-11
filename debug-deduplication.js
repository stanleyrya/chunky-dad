// Debug script for calendar deduplication
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

async function debugDeduplication() {
    try {
        console.log('🔍 Debugging calendar deduplication...\n');
        
        // Create a calendar core instance
        const calendarCore = new CalendarCore();
        
        // Read the NYC calendar data
        const icalData = fs.readFileSync('data/calendars/new-york.ics', 'utf8');
        
        // Parse the calendar data
        const events = calendarCore.parseICalData(icalData);
        
        console.log(`📊 Total events parsed: ${events.length}`);
        
        // Find GOLDILOXX events
        const goldiloxxEvents = events.filter(event => 
            event.name && event.name.toLowerCase().includes('goldiloxx')
        );
        
        console.log(`\n🎭 GOLDILOXX events found: ${goldiloxxEvents.length}`);
        
        goldiloxxEvents.forEach((event, index) => {
            console.log(`\n--- Event ${index + 1} ---`);
            console.log(`Name: ${event.name}`);
            console.log(`Date: ${event.startDate ? event.startDate.toISOString().split('T')[0] : 'N/A'}`);
            console.log(`Time: ${event.time || 'N/A'}`);
            console.log(`Recurring: ${event.recurring ? 'Yes' : 'No'}`);
            console.log(`Recurrence: ${event.recurrence || 'N/A'}`);
            console.log(`Recurrence ID: ${event.recurrenceId ? event.recurrenceId.toISOString().split('T')[0] : 'N/A'}`);
            console.log(`UID: ${event.uid || 'N/A'}`);
            console.log(`Bar: ${event.bar || 'N/A'}`);
            console.log(`Cover: ${event.cover || 'N/A'}`);
            
            // Check if this is a merged event
            if (event.getEffectiveDataForDate) {
                console.log(`✅ This is a merged event with exception handling`);
                
                // Test getting exception data for October 25th
                const oct25 = new Date('2025-10-25');
                const exceptionData = event.getEffectiveDataForDate(oct25);
                if (exceptionData) {
                    console.log(`🎯 Exception data for Oct 25: ${exceptionData.bar || 'N/A'} - ${exceptionData.cover || 'N/A'}`);
                } else {
                    console.log(`ℹ️ No exception data for Oct 25`);
                }
            } else {
                console.log(`❌ This is NOT a merged event`);
            }
        });
        
        // Let's also check all events to see what we have
        console.log(`\n📋 All events:`);
        events.forEach((event, index) => {
            console.log(`${index + 1}. ${event.name} (${event.startDate ? event.startDate.toISOString().split('T')[0] : 'N/A'}) - UID: ${event.uid || 'N/A'} - Recurring: ${event.recurring} - RecurrenceID: ${event.recurrenceId ? event.recurrenceId.toISOString().split('T')[0] : 'N/A'}`);
        });
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error(error.stack);
    }
}

// Run the debug
debugDeduplication();
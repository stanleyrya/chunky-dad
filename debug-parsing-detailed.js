// Detailed debug script for calendar parsing
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

async function debugParsingDetailed() {
    try {
        console.log('🔍 Detailed debugging of calendar parsing...\n');
        
        // Create a calendar core instance
        const calendarCore = new CalendarCore();
        
        // Read the NYC calendar data
        const icalData = fs.readFileSync('data/calendars/new-york.ics', 'utf8');
        
        // Parse the calendar data with detailed logging
        const originalDebug = global.logger.debug;
        global.logger.debug = (component, message, data) => {
            if (component === 'CALENDAR' && message.includes('Starting to parse event')) {
                console.log(`🔍 ${message}`, data);
            }
            if (component === 'CALENDAR' && message.includes('Processing event')) {
                console.log(`🔍 ${message}`, data);
            }
            if (component === 'CALENDAR' && message.includes('Successfully parsed event')) {
                console.log(`✅ ${message}`, data);
            }
            if (component === 'CALENDAR' && message.includes('Failed to parse event')) {
                console.log(`❌ ${message}`, data);
            }
            if (component === 'CALENDAR' && message.includes('Event #') && message.includes('has no title')) {
                console.log(`⚠️ ${message}`, data);
            }
        };
        
        const events = calendarCore.parseICalData(icalData);
        
        // Restore original logger
        global.logger.debug = originalDebug;
        
        console.log(`\n📊 Total events parsed: ${events.length}`);
        
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
        });
        
        // Let's also check all events
        console.log(`\n📋 All events:`);
        events.forEach((event, index) => {
            console.log(`${index + 1}. ${event.name} (${event.startDate ? event.startDate.toISOString().split('T')[0] : 'N/A'}) - UID: ${event.uid || 'N/A'}`);
        });
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error(error.stack);
    }
}

// Run the debug
debugParsingDetailed();
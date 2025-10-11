// Test script for RECURRENCE-ID parsing
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

async function testRecurrenceId() {
    try {
        console.log('🧪 Testing RECURRENCE-ID parsing...\n');
        
        // Create a calendar core instance
        const calendarCore = new CalendarCore();
        
        // Test the parseEventLine method directly
        const testLine = 'RECURRENCE-ID;TZID=America/New_York:20251025T210000';
        const currentEvent = {};
        
        console.log(`Testing line: ${testLine}`);
        
        const result = calendarCore.parseEventLine(testLine, currentEvent);
        
        console.log(`Parse result: ${result}`);
        console.log(`Current event:`, currentEvent);
        console.log(`Recurrence ID: ${currentEvent.recurrenceId ? currentEvent.recurrenceId.toISOString() : 'N/A'}`);
        
        // Test with a simpler line
        const testLine2 = 'RECURRENCE-ID:20251025T210000';
        const currentEvent2 = {};
        
        console.log(`\nTesting line: ${testLine2}`);
        
        const result2 = calendarCore.parseEventLine(testLine2, currentEvent2);
        
        console.log(`Parse result: ${result2}`);
        console.log(`Current event:`, currentEvent2);
        console.log(`Recurrence ID: ${currentEvent2.recurrenceId ? currentEvent2.recurrenceId.toISOString() : 'N/A'}`);
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error(error.stack);
    }
}

// Run the test
testRecurrenceId();
// Debug script for calendar parsing
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

async function debugParsing() {
    try {
        console.log('🔍 Debugging calendar parsing...\n');
        
        // Create a calendar core instance
        const calendarCore = new CalendarCore();
        
        // Read the NYC calendar data
        const icalData = fs.readFileSync('data/calendars/new-york.ics', 'utf8');
        
        // Find the GOLDILOXX events in the raw data
        const lines = icalData.split('\n');
        let inEvent = false;
        let eventCount = 0;
        let currentEvent = '';
        let hasGoldiloxxSummary = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line === 'BEGIN:VEVENT') {
                inEvent = true;
                currentEvent = '';
                hasGoldiloxxSummary = false;
            } else if (line === 'END:VEVENT') {
                if (inEvent && hasGoldiloxxSummary) {
                    eventCount++;
                    console.log(`\n--- GOLDILOXX Event ${eventCount} ---`);
                    console.log(currentEvent);
                }
                inEvent = false;
                currentEvent = '';
                hasGoldiloxxSummary = false;
            } else if (inEvent) {
                currentEvent += line + '\n';
                if (line.startsWith('SUMMARY:GOLDILOXX')) {
                    hasGoldiloxxSummary = true;
                }
            }
        }
        
        console.log(`\n📊 Found ${eventCount} GOLDILOXX events in raw ICS data`);
        
        // Now test the parsing
        console.log('\n🧪 Testing parsing...');
        const events = calendarCore.parseICalData(icalData);
        
        const goldiloxxEvents = events.filter(event => 
            event.name && event.name.toLowerCase().includes('goldiloxx')
        );
        
        console.log(`📊 Parsed ${goldiloxxEvents.length} GOLDILOXX events`);
        
        goldiloxxEvents.forEach((event, index) => {
            console.log(`\n--- Parsed Event ${index + 1} ---`);
            console.log(`Name: ${event.name}`);
            console.log(`Date: ${event.startDate ? event.startDate.toISOString().split('T')[0] : 'N/A'}`);
            console.log(`Recurring: ${event.recurring ? 'Yes' : 'No'}`);
            console.log(`Recurrence ID: ${event.recurrenceId ? event.recurrenceId.toISOString().split('T')[0] : 'N/A'}`);
            console.log(`UID: ${event.uid || 'N/A'}`);
        });
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        console.error(error.stack);
    }
}

// Run the debug
debugParsing();
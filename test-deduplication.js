const fs = require('fs');
const path = require('path');

// Mock logger for Node.js environment
global.logger = {
    componentInit: () => {},
    componentLoad: () => {},
    componentError: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    time: () => {},
    timeEnd: () => {}
};

// Load the CalendarCore class
const CalendarCore = require('./js/calendar-core.js');

async function testDeduplication() {
    try {
        console.log('Testing calendar deduplication...');
        
        // Read the NYC calendar file
        const icalPath = path.join(__dirname, 'data/calendars/new-york.ics');
        const icalText = fs.readFileSync(icalPath, 'utf8');
        
        console.log('iCal file loaded, length:', icalText.length);
        
        // Parse the calendar
        const calendar = new CalendarCore();
        const events = calendar.parseICalData(icalText);
        
        console.log('Total events parsed:', events.length);
        
        // Find GOLDILOXX events
        const goldiloxxEvents = events.filter(e => e.name && e.name.includes('GOLDILOXX'));
        
        console.log('GOLDILOXX events found:', goldiloxxEvents.length);
        
        goldiloxxEvents.forEach((event, index) => {
            console.log(`\nGOLDILOXX Event ${index + 1}:`);
            console.log('  Name:', event.name);
            console.log('  UID:', event.uid);
            console.log('  Recurring:', event.recurring);
            console.log('  Recurrence:', event.recurrence);
            console.log('  Recurrence ID:', event.recurrenceId);
            console.log('  Start Date:', event.startDate ? event.startDate.toISOString().split('T')[0] : 'N/A');
            console.log('  Bar:', event.bar || 'N/A');
            console.log('  Cover:', event.cover || 'N/A');
        });
        
        // Check if deduplication worked
        if (goldiloxxEvents.length === 1) {
            console.log('\n✅ SUCCESS: Only one GOLDILOXX event found (deduplication working!)');
        } else {
            console.log(`\n❌ FAILED: Expected 1 GOLDILOXX event, found ${goldiloxxEvents.length}`);
        }
        
    } catch (error) {
        console.error('Test error:', error);
    }
}

testDeduplication();
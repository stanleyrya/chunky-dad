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

async function testComparison() {
    try {
        console.log('Testing calendar deduplication comparison...');
        
        // Read the NYC calendar file
        const icalPath = path.join(__dirname, 'data/calendars/new-york.ics');
        const icalText = fs.readFileSync(icalPath, 'utf8');
        
        // Parse the calendar
        const calendar = new CalendarCore();
        const events = calendar.parseICalData(icalText);
        
        console.log('Total events after deduplication:', events.length);
        
        // Find GOLDILOXX events
        const goldiloxxEvents = events.filter(e => e.name && e.name.includes('GOLDILOXX'));
        
        console.log('\n=== DEDUPLICATED GOLDILOXX EVENTS ===');
        goldiloxxEvents.forEach((event, index) => {
            console.log(`\nGOLDILOXX Event ${index + 1} (MERGED):`);
            console.log('  Name:', event.name);
            console.log('  UID:', event.uid);
            console.log('  Recurring:', event.recurring);
            console.log('  Recurrence:', event.recurrence);
            console.log('  Recurrence ID:', event.recurrenceId);
            console.log('  Start Date:', event.startDate ? event.startDate.toISOString().split('T')[0] : 'N/A');
            console.log('  Bar:', event.bar || 'N/A');
            console.log('  Cover:', event.cover || 'N/A');
            console.log('  Tea:', event.tea || 'N/A');
            
            // Check if this is a merged event with exceptions
            if (event._exceptions) {
                console.log('  Exceptions:', event._exceptions.length);
                event._exceptions.forEach((exception, i) => {
                    console.log(`    Exception ${i + 1}:`);
                    console.log('      Date:', exception.startDate ? exception.startDate.toISOString().split('T')[0] : 'N/A');
                    console.log('      Bar:', exception.bar || 'N/A');
                    console.log('      Cover:', exception.cover || 'N/A');
                });
            }
        });
        
        // Let's also check what the original raw events looked like
        console.log('\n=== CHECKING ORIGINAL RAW EVENTS ===');
        const lines = icalText.split('\n');
        let inGoldiloxxEvent = false;
        let eventCount = 0;
        let currentEvent = {};
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (line === 'BEGIN:VEVENT') {
                inGoldiloxxEvent = false;
                currentEvent = {};
            } else if (line === 'END:VEVENT' && inGoldiloxxEvent) {
                eventCount++;
                console.log(`\nRaw GOLDILOXX Event ${eventCount}:`);
                console.log('  UID:', currentEvent.uid || 'N/A');
                console.log('  Recurring:', currentEvent.recurrence ? 'Yes' : 'No');
                console.log('  Recurrence:', currentEvent.recurrence || 'N/A');
                console.log('  Recurrence ID:', currentEvent.recurrenceId || 'N/A');
                console.log('  Start Date:', currentEvent.start ? currentEvent.start.toISOString().split('T')[0] : 'N/A');
                console.log('  Description preview:', (currentEvent.description || '').substring(0, 100) + '...');
                inGoldiloxxEvent = false;
            } else if (inGoldiloxxEvent) {
                if (line.startsWith('SUMMARY:') && line.includes('GOLDILOXX')) {
                    inGoldiloxxEvent = true;
                }
                if (line.startsWith('UID:')) currentEvent.uid = line.substring(4).trim();
                if (line.startsWith('RRULE:')) currentEvent.recurrence = line.substring(6);
                if (line.startsWith('RECURRENCE-ID')) currentEvent.recurrenceId = line.substring(14);
                if (line.startsWith('DTSTART')) {
                    const dateMatch = line.match(/DTSTART[^:]*:(.+)/);
                    if (dateMatch) {
                        currentEvent.start = new Date(dateMatch[1].replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'));
                    }
                }
                if (line.startsWith('DESCRIPTION:')) currentEvent.description = line.substring(12);
            } else if (line.startsWith('SUMMARY:') && line.includes('GOLDILOXX')) {
                inGoldiloxxEvent = true;
            }
        }
        
    } catch (error) {
        console.error('Test error:', error);
    }
}

testComparison();
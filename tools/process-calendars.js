const fs = require('fs');
const path = require('path');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');

// Provide basic logging to satisfy dependencies
global.logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: console.error,
    componentInit: () => {},
    componentLoad: () => {},
    componentError: () => {},
    time: () => {},
    timeEnd: () => {},
    apiCall: () => {},
    performance: () => {}
};

// Load EventSchema and CalendarCore
const evSch = require(path.join(ROOT, 'js', 'event-schema.js'));
global.EventSchema = evSch.EventSchema;
const CalendarCore = require(path.join(ROOT, 'js', 'calendar-core.js'));

const calendar = new CalendarCore();

// Load CITY_CONFIG
let CITY_CONFIG;
try {
    const cityModule = require(path.join(ROOT, 'js', 'city-config.js'));
    CITY_CONFIG = cityModule.CITY_CONFIG || {};
} catch (e) {
    console.error('Failed to load CITY_CONFIG:', e.message);
    process.exit(1);
}

// Target cities to test the new JSON logic with
const TARGET_CITIES = ['nyc', 'seattle'];

async function processCalendars() {
    let successCount = 0;
    let errorCount = 0;

    const calendarsDir = path.join(ROOT, 'data', 'calendars');

    for (const cityKey of TARGET_CITIES) {
        if (!CITY_CONFIG[cityKey] || CITY_CONFIG[cityKey].visible === false) {
            console.log(`Skipping ${cityKey} (not in config or not visible)`);
            continue;
        }

        const icsPath = path.join(calendarsDir, `${cityKey}.ics`);
        const jsonPath = path.join(calendarsDir, `${cityKey}.json`);

        if (!fs.existsSync(icsPath)) {
            console.log(`Skipping ${cityKey} (no ICS file found at ${icsPath})`);
            continue;
        }

        try {
            const icalText = fs.readFileSync(icsPath, 'utf8');

            // Re-instantiate calendar core to ensure a clean state
            const cityCalendar = new CalendarCore();

            // Set timezone environment for Node to parse dates accurately if needed, though CalendarCore should handle it
            try {
                const tzMatch = icalText.match(/X-WR-TIMEZONE:(.+)/);
                if (tzMatch && tzMatch[1]) {
                    process.env.TZ = tzMatch[1].trim();
                }
            } catch (_) {}

            const events = cityCalendar.parseICalData(icalText) || [];

            // Also store calendar metadata in the JSON if available
            const output = {
                metadata: {
                    calendarTimezone: cityCalendar.calendarTimezone,
                    timezoneData: cityCalendar.timezoneData,
                },
                events: events
            };

            const dateReplacer = function(key, value) {
                if (this[key] instanceof Date) {
                    const date = this[key];
                    const calendarTimezone = cityCalendar.calendarTimezone || "America/New_York";
                    const formatter = new Intl.DateTimeFormat('en-CA', {
                        timeZone: calendarTimezone,
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        hour12: false
                    });
                    const parts = formatter.formatToParts(date);
                    const y = parts.find(p => p.type === 'year')?.value;
                    const mo = parts.find(p => p.type === 'month')?.value;
                    const d = parts.find(p => p.type === 'day')?.value;
                    let h = parts.find(p => p.type === 'hour')?.value;
                    if (h === '24') h = '00';
                    const mi = parts.find(p => p.type === 'minute')?.value;
                    const s = parts.find(p => p.type === 'second')?.value;

                    return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
                }
                return value;
            };

            fs.writeFileSync(jsonPath, JSON.stringify(output, dateReplacer, 2));
            console.log(`✓ Processed ${cityKey}.ics -> ${cityKey}.json (${events.length} events)`);
            successCount++;
        } catch (error) {
            console.error(`✗ Error processing ${cityKey}:`, error);
            errorCount++;
        }
    }

    console.log(`\nProcessing complete: ${successCount} successful, ${errorCount} failed.`);
    if (errorCount > 0) {
        process.exit(1);
    }
}

processCalendars();

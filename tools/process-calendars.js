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
                    const pad = (n) => n.toString().padStart(2, '0');
                    const date = this[key];
                    const localString = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

                    // DEBUG LOGGING FOR DATE SHIFT ISSUE
                    if (key === 'startDate' || key === 'endDate') {
                        console.log(`[PROCESS-CALENDARS-DEBUG] replacer for ${key}:`, {
                            originalDateStr: date.toString(),
                            isoString: date.toISOString(),
                            getDate: date.getDate(),
                            getHours: date.getHours(),
                            generatedString: localString
                        });
                    }

                    return localString;
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

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

            console.log(`[${cityKey}] Starting ICS parsing...`);
            const events = cityCalendar.parseICalData(icalText) || [];
            console.log(`[${cityKey}] Finished ICS parsing. Found ${events.length} events.`);

            // Also store calendar metadata in the JSON if available
            const output = {
                metadata: {
                    calendarTimezone: cityCalendar.calendarTimezone,
                    timezoneData: cityCalendar.timezoneData,
                },
                events: events
            };

            console.log(`[${cityKey}] Starting JSON serialization with dateReplacer...`);
            const dateReplacer = function(key, value) {
                if (this[key] instanceof Date) {
                    const date = this[key];

                    // Dates parsed by CalendarCore are constructed using local Date components
                    // that directly correspond to the target timezone's time.
                    // For example, an event starting at 5:00 PM EDT is parsed into a Date object
                    // such that date.getFullYear(), date.getMonth(), and date.getHours() (which is 17)
                    // directly match the EDT time.
                    // Therefore, we must format it using its raw local methods rather than
                    // applying an Intl.DateTimeFormat conversion, which would treat the local system's
                    // offset as UTC/another timezone and mistakenly shift it again.

                    const pad = (n) => n.toString().padStart(2, '0');
                    const y = date.getFullYear();
                    const mo = pad(date.getMonth() + 1);
                    const d = pad(date.getDate());
                    const h = pad(date.getHours());
                    const mi = pad(date.getMinutes());
                    const s = pad(date.getSeconds());

                    const finalString = `${y}-${mo}-${d}T${h}:${mi}:${s}`;

                    return finalString;
                }
                return value;
            };

            const jsonString = JSON.stringify(output, dateReplacer, 2);
            fs.writeFileSync(jsonPath, jsonString);
            console.log(`[${cityKey}] Finished JSON serialization.`);
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

const fs = require('fs');
const path = require('path');

const DEBUG = process.env.DEBUG === 'true';

function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

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

            // Log raw parsed events before serialization specifically to check if they shifted
            for (let i = 0; i < events.length; i++) {
                const e = events[i];
                debugLog(`\n[Pre-Serialization Check] Event: ${e.name} (UID: ${e.uid})`);
                debugLog(`  Raw startDate: ${e.startDate ? e.startDate.toISOString() : null}`);
                debugLog(`  Raw endDate:   ${e.endDate ? e.endDate.toISOString() : null}`);
                if (e.recurrence) debugLog(`  Recurrence: ${e.recurrence}`);
            }

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
                    const calendarTimezone = cityCalendar.calendarTimezone || "America/New_York";
                    const eventIdentifier = this.name || this.uid || 'Unknown Event';

                    debugLog(`\n[DateReplacer - ${key || 'root'} for Event: ${eventIdentifier}] Original Date object (ISO): ${date.toISOString()}`);
                    debugLog(`[DateReplacer - ${key || 'root'} for Event: ${eventIdentifier}] Original Date object (Local): ${date.toString()}`);
                    debugLog(`[DateReplacer - ${key || 'root'} for Event: ${eventIdentifier}] Intended target timezone: ${calendarTimezone}`);

                    const formatter = new Intl.DateTimeFormat('en-CA', {
                        timeZone: calendarTimezone,
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        hourCycle: 'h23'
                    });
                    const parts = formatter.formatToParts(date);
                    debugLog(`[DateReplacer - ${key || 'root'} for Event: ${eventIdentifier}] Formatter parts:`, JSON.stringify(parts));

                    const y = parts.find(p => p.type === 'year')?.value;
                    const mo = parts.find(p => p.type === 'month')?.value;
                    const d = parts.find(p => p.type === 'day')?.value;
                    let h = parts.find(p => p.type === 'hour')?.value;

                    debugLog(`[DateReplacer - ${key || 'root'} for Event: ${eventIdentifier}] Extracted components -> Year: ${y}, Month: ${mo}, Day: ${d}, Hour: ${h}`);

                    const mi = parts.find(p => p.type === 'minute')?.value;
                    const s = parts.find(p => p.type === 'second')?.value;

                    const finalString = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
                    debugLog(`[DateReplacer - ${key || 'root'} for Event: ${eventIdentifier}] Final serialized string: ${finalString}`);

                    // Validate string isn't shifting unexpectedly due to Node bug or format
                    debugLog(`[DateReplacer - ${key || 'root'} for Event: ${eventIdentifier}] Final components mapping check -> ${finalString} matches extracted: ${y}-${mo}-${d}`);

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

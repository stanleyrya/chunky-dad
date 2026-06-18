const fs = require('fs');

const eventSchemaCode = fs.readFileSync('js/event-schema.js', 'utf8');

global.logger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, componentInit: () => {}, time: () => {}, timeEnd: () => {}, performance: () => {}, apiCall: () => {}, componentError: () => {} };
global.window = { addEventListener: () => {} };
global.document = { getElementById: () => ({ addEventListener: () => {} }), querySelector: () => null };

eval(eventSchemaCode);

const CalendarCore = require('./js/calendar-core.js');

const code2 = fs.readFileSync('js/dynamic-calendar-loader.js', 'utf8');

const wrapper = `
  const CalendarCore = require('./js/calendar-core.js');
  ${code2}
  module.exports = DynamicCalendarLoader;
`;

fs.writeFileSync('temp_loader.js', wrapper);
const DynamicCalendarLoader = require('./temp_loader.js');

const data = JSON.parse(fs.readFileSync('data/calendars/nyc.json', 'utf8'));

const loader = new DynamicCalendarLoader();
loader.allEvents = data.events.map(e => {
    if (e.startDate) e.startDate = new Date(e.startDate);
    if (e.endDate) e.endDate = new Date(e.endDate);
    return e;
});

const start = new Date("2026-06-14T00:00:00.000Z");
const end = new Date("2026-06-20T23:59:59.000Z");

const expandedEvents = loader.expandRecurringEvents(loader.allEvents, start, end);
for (const e of expandedEvents) {
    if (e.name === "Beer Blast") {
        console.log("Expanded event before fix:");
        console.log("  startDate:", e.startDate.toISOString());
        console.log("  endDate:", e.endDate.toISOString());
    }
}

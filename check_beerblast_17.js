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

// Since the user is complaining they are not seeing Beer Blast AT ALL,
// perhaps it's related to the logic that shifts late-night events? Let's trace it carefully.
loader.currentDate = new Date();
loader.currentView = "week";
loader.calendarTimezone = 'America/New_York';

const start = new Date("2026-06-14T00:00:00.000Z");
const end = new Date("2026-06-20T23:59:59.000Z");

const deduplicatedEvents = loader.getFilteredEvents();

for (const e of deduplicatedEvents) {
    if (e.name === "Beer Blast") {
        console.log("Beer Blast logic dates:");
        console.log("startDate:", loader.getLogicalStartDate(e));
        console.log("endDate:", loader.getLogicalEndDate(e));
    }
}

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

const loader = new DynamicCalendarLoader();

const event = {
  "name": "Beer Blast",
  "recurring": true,
  "startDate": new Date("2026-06-21T21:00:00.000Z"), // Next week
  "endDate": new Date("2026-06-21T08:00:00.000Z"),
  "isExpanded": true
};

const day = new Date("2026-06-21T00:00:00.000Z");

const dayDate = new Date(day);
dayDate.setHours(0, 0, 0, 0);

if (loader.isMultiDay(event)) {
    console.log("It is a multi-day event.");
    const eventDate = loader.getLogicalStartDate(event);
    eventDate.setHours(0, 0, 0, 0);
    const eventEndDate = loader.getLogicalEndDate(event);
    eventEndDate.setHours(0, 0, 0, 0);

    const matches = dayDate >= eventDate && dayDate <= eventEndDate;
    console.log("Multi-day matches?", matches);
} else {
    console.log("It is not multi-day.");
}

if (event.isExpanded) {
    const eventDate = loader.getLogicalStartDate(event);
    eventDate.setHours(0, 0, 0, 0);

    console.log("eventDate:", eventDate.toISOString());
    console.log("dayDate:", dayDate.toISOString());
    console.log("Expanded matches?", eventDate.getTime() === dayDate.getTime());
}

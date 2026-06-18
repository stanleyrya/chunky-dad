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
loader.currentDate = new Date("2026-06-17");
loader.currentView = "week";
loader.calendarTimezone = 'America/New_York';

// Mock all DOM-generating dependencies to just return strings
loader.formatEventDates = () => "";
loader.getEnhancedDayTimeDisplay = () => "";
loader.getSmartEventNameForBreakpoint = () => "Beer Blast";
loader.getBadgeElements = () => "";
loader.getEventIdentityContent = () => "";
loader.getRecurringBadgeContent = () => "";
loader.getDateBadgeContent = () => "";

const deduplicatedEvents = loader.getFilteredEvents();

const { start, end } = loader.getCurrentPeriodBounds();
const today = new Date("2026-06-17"); // just a mock today
today.setHours(0, 0, 0, 0);

try {
    const htmlDays = loader.generateWeekView(deduplicatedEvents, start, end, today, false);

    console.log("Sunday HTML:\n", htmlDays[0]);
} catch(e) {
    console.log("Error running generateWeekView:", e);
}

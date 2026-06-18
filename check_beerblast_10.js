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

const deduplicatedEvents = loader.getFilteredEvents();

const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const { start, end } = loader.getCurrentPeriodBounds();
const days = [];
for (let i = 0; i < 7; i++) {
    const currentDay = new Date(start);
    currentDay.setDate(start.getDate() + i);
    days.push(currentDay);
}

const day = days[0]; // June 14, Sunday

const dayEvents = deduplicatedEvents.filter(event => {
    if (!event.startDate) return false;

    const dayDate = new Date(day);
    dayDate.setHours(0, 0, 0, 0);

    if (loader.isMultiDay(event)) {
        const eventDate = loader.getLogicalStartDate(event);
        eventDate.setHours(0, 0, 0, 0);
        const eventEndDate = loader.getLogicalEndDate(event);
        eventEndDate.setHours(0, 0, 0, 0);

        return dayDate >= eventDate && dayDate <= eventEndDate;
    }

    if (event.isExpanded) {
        const eventDate = loader.getLogicalStartDate(event);
        eventDate.setHours(0, 0, 0, 0);

        return eventDate.getTime() === dayDate.getTime();
    }

    if (event.recurring) {
        return loader.doesRecurringEventOccurOnDate(event, day);
    }

    const eventDate = loader.getLogicalStartDate(event);
    eventDate.setHours(0, 0, 0, 0);

    return eventDate.getTime() === dayDate.getTime();
});

console.log("Sunday events count before sort:", dayEvents.length);
console.log(dayEvents.map(e => e.name));

const filteredDayEvents = dayEvents.sort((a, b) => {
    const aIsMultiDay = loader.isMultiDay(a);
    const bIsMultiDay = loader.isMultiDay(b);
    const aIsAllDay = !a.time;
    const bIsAllDay = !b.time;

    // 1. Multi-day events go first
    if (aIsMultiDay && !bIsMultiDay) return -1;
    if (!aIsMultiDay && bIsMultiDay) return 1;

    // 2. All-day events go second
    if (aIsAllDay && !bIsAllDay) return -1;
    if (!aIsAllDay && bIsAllDay) return 1;

    // 3. Sort by start time for single-day events
    const dateA = new Date(a.startDate);
    const dateB = new Date(b.startDate);

    return dateA.getTime() - dateB.getTime();
});

console.log("Sunday events count after sort:", filteredDayEvents.length);
console.log(filteredDayEvents.map(e => e.name));

process.env.TZ = "America/New_York";
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

const evSch = require('./js/event-schema.js');
global.EventSchema = evSch.EventSchema;
const CalendarCore = require('./js/calendar-core.js');

const icalText = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:NYC Calendar
X-WR-TIMEZONE:America/New_York
BEGIN:VTIMEZONE
TZID:America/New_York
X-LIC-LOCATION:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
DTSTART;TZID=America/New_York:20250704T220000
DTEND;TZID=America/New_York:20250705T040000
RRULE:FREQ=MONTHLY;BYDAY=1FR
DTSTAMP:20260617T184850Z
UID:bdstnukmpv6keg7pon3fram2qg@google.com
CREATED:20250719T041643Z
DESCRIPTION:Tea
LAST-MODIFIED:20250723T045823Z
LOCATION:40.7326824, -74.0097099
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:Rockstrap
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR`;

const cityCalendar = new CalendarCore();
const events = cityCalendar.parseICalData(icalText) || [];
for (let i = 0; i < events.length; i++) {
    const e = events[i];
    console.log(`[Test Result] Event: ${e.name}`);
    console.log(`  Start: ${e.startDate ? e.startDate.toISOString() : null}`);
    console.log(`  End:   ${e.endDate ? e.endDate.toISOString() : null}`);
}

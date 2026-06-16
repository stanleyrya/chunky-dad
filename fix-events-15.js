const fs = require('fs');

let content = fs.readFileSync('js/dynamic-calendar-loader.js', 'utf8');

content = content.replace(
    /const mobileTime = isMultiDay && window\.formatEventDates \? window\.formatEventDates\(event\) : \(event\.time \? this\.formatTimeForMobile\(event\.time\) : null\);/g,
    `const mobileTime = isMultiDay && window.formatEventDates ? window.formatEventDates(event) : (!isMultiDay && event.time ? this.formatTimeForMobile(event.time) : null);`
);

fs.writeFileSync('js/dynamic-calendar-loader.js', content, 'utf8');
console.log('Fixed dynamic-calendar-loader.js part 15');

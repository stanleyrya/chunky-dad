const fs = require('fs');

const data = JSON.parse(fs.readFileSync('data/calendars/nyc.json', 'utf8'));

// Print all events that have "Beer Blast" in the name
for (const e of data.events) {
    if (e.name === "Beer Blast") {
        console.log(e);
    }
}

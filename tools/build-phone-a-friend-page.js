#!/usr/bin/env node
// Writes phone-a-friend/index.html — the page a friend opens from a
// "phone a friend" link (chunky.dad/phone-a-friend/) — from the review deck's own code (serve-results
// renderFriendPage). Run after any change to the deck; a test fails while
// the committed page differs from what the deck renders.
//   node tools/build-phone-a-friend-page.js
const fs = require('fs');
const path = require('path');
const { renderFriendPage } = require('./serve-results.js');

const target = path.join(__dirname, '..', 'phone-a-friend', 'index.html');
const html = renderFriendPage();
fs.mkdirSync(path.dirname(target), { recursive: true });
const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
if (before === html) {
    console.log('phone-a-friend/index.html is current');
} else {
    fs.writeFileSync(target, html);
    console.log(`phone-a-friend/index.html written (${html.length} chars)`);
}

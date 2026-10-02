#!/usr/bin/env node
// Writes advice/index.html — the page a friend opens from a "phone a
// friend" link — from the review deck's own code (serve-results
// renderFriendPage). Run after any change to the deck; a test fails while
// the committed page differs from what the deck renders.
//   node tools/build-advice-page.js
const fs = require('fs');
const path = require('path');
const { renderFriendPage } = require('./serve-results.js');

const target = path.join(__dirname, '..', 'advice', 'index.html');
const html = renderFriendPage();
fs.mkdirSync(path.dirname(target), { recursive: true });
const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
if (before === html) {
    console.log('advice/index.html is current');
} else {
    fs.writeFileSync(target, html);
    console.log(`advice/index.html written (${html.length} chars)`);
}

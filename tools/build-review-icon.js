#!/usr/bin/env node
// Renders the review deck's home-screen icon (favicons/review-icon-180.png
// and -512.png): the site's dad face on the deck's dark ground with a
// green check badge, so it reads apart from the site's own icon. Run once
// after changing the face; needs puppeteer-core and a local Chrome
// (PUPPETEER_EXECUTABLE_PATH, default /Applications/Google Chrome.app).
//   node tools/build-review-icon.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const face = fs.readFileSync(path.join(root, 'favicons', 'android-chrome-512x512.png')).toString('base64');
const html = `<!doctype html><html><head><style>
html,body{margin:0;width:512px;height:512px;overflow:hidden}
.ground{position:absolute;inset:0;background:radial-gradient(circle at 50% 38%, #3a2a1d 0%, #1d1915 62%, #151412 100%)}
.ring{position:absolute;left:56px;top:46px;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle, rgba(255,107,53,.28) 0%, rgba(255,107,53,0) 70%)}
.face{position:absolute;left:86px;top:70px;width:340px;height:340px;filter:drop-shadow(0 14px 22px rgba(0,0,0,.45))}
.badge{position:absolute;right:58px;bottom:58px;width:132px;height:132px;border-radius:50%;background:#2f9e5f;border:10px solid #151412;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
.badge svg{width:70px;height:70px}
</style></head><body><div class="ground"></div><div class="ring"></div>
<img class="face" src="data:image/png;base64,${face}">
<div class="badge"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg></div>
</body></html>`;

(async () => {
    const { default: puppeteer } = await import(path.join(root, 'node_modules', 'puppeteer-core', 'lib', 'esm', 'puppeteer', 'puppeteer-core.js'));
    const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        for (const size of [512, 180]) {
            await page.setViewport({ width: 512, height: 512, deviceScaleFactor: size / 512 });
            await page.setContent(html, { waitUntil: 'load' });
            const out = path.join(root, 'favicons', `review-icon-${size}.png`);
            await page.screenshot({ path: out, omitBackground: false });
            console.log(`wrote ${path.relative(root, out)}`);
        }
    } finally {
        await browser.close();
    }
})();

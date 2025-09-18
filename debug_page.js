const puppeteer = require('puppeteer');

async function debugPage() {
    let browser;
    try {
        console.log('Launching browser...');
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Capture console messages
        const consoleMessages = [];
        page.on('console', msg => {
            consoleMessages.push({
                type: msg.type(),
                text: msg.text(),
                location: msg.location()
            });
        });
        
        // Capture page errors
        const pageErrors = [];
        page.on('pageerror', error => {
            pageErrors.push({
                message: error.message,
                stack: error.stack
            });
        });
        
        // Capture network failures
        const networkErrors = [];
        page.on('requestfailed', request => {
            networkErrors.push({
                url: request.url(),
                failure: request.failure()
            });
        });
        
        console.log('Loading city.html...');
        await page.goto('http://localhost:8000/city.html?city=new-york', {
            waitUntil: 'networkidle0',
            timeout: 10000
        });
        
        // Wait a bit for any async operations
        await page.waitForTimeout(2000);
        
        console.log('\n=== CONSOLE MESSAGES ===');
        consoleMessages.forEach(msg => {
            console.log(`[${msg.type}] ${msg.text}`);
            if (msg.location && msg.location.url) {
                console.log(`  Location: ${msg.location.url}:${msg.location.lineNumber}`);
            }
        });
        
        console.log('\n=== PAGE ERRORS ===');
        pageErrors.forEach(error => {
            console.log(`Error: ${error.message}`);
            if (error.stack) {
                console.log(`Stack: ${error.stack}`);
            }
        });
        
        console.log('\n=== NETWORK ERRORS ===');
        networkErrors.forEach(error => {
            console.log(`Failed: ${error.url}`);
            console.log(`  Reason: ${error.failure?.errorText || 'Unknown'}`);
        });
        
        // Check if specific elements are loaded
        console.log('\n=== ELEMENT CHECKS ===');
        const calendarTitle = await page.$('#calendar-title');
        console.log(`Calendar title element: ${calendarTitle ? 'Found' : 'Not found'}`);
        
        const eventsList = await page.$('.events-list');
        console.log(`Events list element: ${eventsList ? 'Found' : 'Not found'}`);
        
        const mapContainer = await page.$('#events-map');
        console.log(`Map container element: ${mapContainer ? 'Found' : 'Not found'}`);
        
    } catch (error) {
        console.error('Error during debugging:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

debugPage().catch(console.error);
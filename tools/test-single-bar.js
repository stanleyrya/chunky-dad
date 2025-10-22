#!/usr/bin/env node

// Test script to debug a single bar's GayCities parsing
async function testSingleBar() {
    const url = 'https://seattle.gaycities.com/bars/the-lumber-yard-bar-seattle';
    
    console.log(`🔍 Testing GayCities parsing for: ${url}`);
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BarDataScraper/1.0)'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const html = await response.text();
        
        // Look for all external links
        const allLinks = html.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g);
        console.log(`\n📋 Found ${allLinks ? allLinks.length : 0} external links:`);
        
        if (allLinks) {
            allLinks.slice(0, 10).forEach((link, index) => {
                const href = link.match(/href="([^"]+)"/);
                if (href) {
                    console.log(`  ${index + 1}. ${href[1]}`);
                }
            });
        }
        
        // Look for Instagram specifically
        const instagramLinks = html.match(/<a[^>]*href="(https?:\/\/[^"]*instagram[^"]*)"[^>]*>/gi);
        console.log(`\n📋 Found ${instagramLinks ? instagramLinks.length : 0} Instagram links:`);
        if (instagramLinks) {
            instagramLinks.forEach((link, index) => {
                const href = link.match(/href="([^"]+)"/);
                if (href) {
                    console.log(`  ${index + 1}. ${href[1]}`);
                }
            });
        }
        
        // Look for Facebook specifically
        const facebookLinks = html.match(/<a[^>]*href="(https?:\/\/[^"]*facebook[^"]*)"[^>]*>/gi);
        console.log(`\n📋 Found ${facebookLinks ? facebookLinks.length : 0} Facebook links:`);
        if (facebookLinks) {
            facebookLinks.forEach((link, index) => {
                const href = link.match(/href="([^"]+)"/);
                if (href) {
                    console.log(`  ${index + 1}. ${href[1]}`);
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testSingleBar();
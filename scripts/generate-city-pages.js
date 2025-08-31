#!/usr/bin/env node

// Script to generate individual HTML files for each city
// This enables friendly URLs like /seattle instead of /city.html?city=seattle

const fs = require('fs');
const path = require('path');

// Import city configuration
const cityConfigPath = path.join(__dirname, '../js/city-config.js');
const cityConfigContent = fs.readFileSync(cityConfigPath, 'utf8');

// Extract CITY_CONFIG object from the file
const configMatch = cityConfigContent.match(/const CITY_CONFIG = ({[\s\S]*?});/);
if (!configMatch) {
    console.error('❌ Could not extract CITY_CONFIG from city-config.js');
    process.exit(1);
}

// Parse the configuration
const CITY_CONFIG = eval(`(${configMatch[1]})`);

// Read the base city.html template
const templatePath = path.join(__dirname, '../city.html');
const template = fs.readFileSync(templatePath, 'utf8');

// Generate HTML for each city
Object.keys(CITY_CONFIG).forEach(cityKey => {
    const cityConfig = CITY_CONFIG[cityKey];
    
    if (cityConfig.visible === false) {
        console.log(`⏭️  Skipping ${cityKey} (not visible)`);
        return;
    }
    
    console.log(`🏙️  Generating ${cityKey}.html for ${cityConfig.name}`);
    
    // Create city-specific HTML
    let cityHtml = template;
    
    // Update title and meta description
    cityHtml = cityHtml.replace(
        '<title>City Guide - chunky.dad Bear Guide</title>',
        `<title>${cityConfig.name} - chunky.dad Bear Guide</title>`
    );
    
    cityHtml = cityHtml.replace(
        '<meta name="description" content="Complete gay bear guide to your city - events, bars, and the hottest bear scene">',
        `<meta name="description" content="Gay bear guide to ${cityConfig.name} - events, bars, and the hottest bear scene">`
    );
    
    // Add city-specific configuration script
    const configScript = `    <!-- City-specific configuration -->
    <script>
        // Set the city for this page
        window.CITY_PAGE_CONFIG = {
            cityKey: '${cityKey}',
            friendlyUrl: true
        };
    </script>`;
    
    // Insert the config script after the Google Analytics script
    cityHtml = cityHtml.replace(
        '</script>\n    \n    <link rel="stylesheet"',
        `</script>\n    \n${configScript}\n    \n    <link rel="stylesheet"`
    );
    
    // Update Google Analytics configuration for this specific page
    cityHtml = cityHtml.replace(
        "gtag('config', 'G-YKQBFFQR5E');",
        `gtag('config', 'G-YKQBFFQR5E', {
        page_title: '${cityConfig.name} - chunky.dad Bear Guide',
        page_location: window.location.href
      });`
    );
    
    // Write the city-specific HTML file
    const outputPath = path.join(__dirname, `../${cityKey}.html`);
    fs.writeFileSync(outputPath, cityHtml);
    
    console.log(`✅ Created ${cityKey}.html`);
});

console.log(`\n🎉 Generated ${Object.keys(CITY_CONFIG).filter(k => CITY_CONFIG[k].visible !== false).length} city pages`);
console.log('\n📝 Next steps:');
console.log('1. Test the pages locally: npm run dev');
console.log('2. Visit http://localhost:8000/seattle to test');
console.log('3. Commit and push to deploy to GitHub Pages');
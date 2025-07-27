# chunky.dad - Gay Bear Travel Guide

A fun and edgy travel resource for the gay bear community, providing quick and essential information for travel planning and discovering bear-owned businesses worldwide.

## About

chunky.dad is the ultimate guide for gay bears on the go! We focus on two main goals:

1. **Travel Information**: Quick and dirty guides to the best bear scenes in major cities, plus time-specific event pages for legendary gatherings
2. **Bear-Owned Businesses**: Directory of businesses owned by and for the bear community

## Features

- **City Guides**: Detailed pages for major bear destinations like New York, Los Angeles, Sitges, and Puerto Vallarta
- **Weekly Event Calendars**: See what's happening each day in your destination city
- **Event Details**: Complete info including venues, cover charges, times, and insider "tea"
- **Major Bear Events**: Information about annual gatherings like Puerto Vallarta Beef Dip and Sitges Bear Week
- **Business Directory**: Bear-owned bars, venues, shops, accommodations, and services (coming soon)
- **Mobile-First Design**: Perfect for planning on the go
- **Community-Driven**: Submit information about events and businesses

## City Pages

Currently available:
- **New York City**: Complete guide with Bear Happy Hour, Eagles NYC, Bears Are Animals, and more

Coming soon:
- Los Angeles
- Sitges
- Puerto Vallarta

## Project Structure

```
chunky-dad/
├── index.html           # Homepage with city overview and event highlights
├── new-york.html        # NYC bear guide with weekly calendar and events
├── styles.css           # Bear-themed responsive styling
├── js/                 # Modular JavaScript architecture
├── scripts/            # Automation tools and scrapers
├── package.json         # Project configuration
└── README.md           # This file
```

## Getting Started

### Local Development

1. **Python HTTP Server** (Recommended):
   ```bash
   python3 -m http.server 8000
   ```

2. **Node.js**:
   ```bash
   npx http-server
   ```

3. **PHP**:
   ```bash
   php -S localhost:8000
   ```

4. **Live Server**: Use VS Code extension or:
   ```bash
   npm install -g live-server
   live-server
   ```

Then visit `http://localhost:8000` to view the site.

## Deployment

The site is designed for GitHub Pages deployment at `chunky.dad`. 

### Deployment Options:

- **GitHub Pages**: Push to main branch and enable Pages
- **Netlify**: Drag and drop or connect to GitHub
- **Vercel**: Connect GitHub repository for auto-deployment
- **Custom Domain**: Point `chunky.dad` to your hosting provider

### Files to Deploy:
- `index.html`
- `new-york.html` (and other city pages)
- `styles.css`
- `js/` directory containing modular JavaScript files

## Content Guidelines

### City Pages Include:
- Weekly event calendar showing what happens each day
- Detailed event information with venues, times, cover charges
- "Tea" (insider info) about events and venues
- Links to Instagram accounts and websites
- Distinction between "Weekly Events" (recurring) and "Routine Events" (occasional)

### Event Information Format:
```
Name: Event Name
Bar: Venue Name
Day: Day of week + Time
Cover: Cover charge details
Tea: Insider information about the event
Links: Instagram, website, etc.
```

## Contributing

Know about bear events or businesses we're missing? We want to hear from you!

### How to Submit Information:
1. Use the contact form on the website
2. Include complete details: venue, timing, cover charges, etc.
3. Provide links to Instagram accounts or websites
4. Share any insider "tea" that would help visitors

### Content We Need:
- Weekly recurring events in major cities
- Annual bear events and gatherings
- Bear-owned businesses (bars, shops, accommodations, services)
- Updates to existing information

## Brand Voice

- **Fun and Edgy**: We keep it real with personality
- **Community-Focused**: By bears, for bears
- **Practical**: Just the info you need to plan your trip
- **Inclusive**: Welcoming to all members of the bear community

## Technical Details

- **Static Site**: Pure HTML, CSS, and JavaScript
- **Responsive Design**: Mobile-first approach
- **Fast Loading**: Optimized for quick access while traveling
- **Progressive Enhancement**: Works with JavaScript disabled
- **SEO Optimized**: Proper meta tags and structure

## Automation Scripts

The `scripts/` directory contains automation tools for maintaining event data:

- **Bear Event Parser**: A Scriptable (iOS) script that automatically:
  - Fetches event data from multiple bear event websites
  - Parses and formats events for our calendar system
  - Detects cities and assigns to appropriate calendars
  - Merges with existing events to avoid duplicates
  - Flags new events as "not-checked" until validated

See [scripts/README.md](scripts/README.md) for detailed documentation on using these tools.

## Browser Support

- Chrome, Firefox, Safari, Edge (latest versions)
- Mobile browsers (iOS Safari, Chrome Mobile)
- Graceful degradation for older browsers

## Scripts / Automatic Event Importer

The `scripts/` directory contains automation tools for maintaining event calendars:

- **Bear Event Scraper**: A Scriptable-based tool that automatically fetches bear events from various websites and syncs them to Google Calendars
- See [scripts/README.md](scripts/README.md) for detailed documentation on setup and usage

## Future Plans

- Expand to more cities (Los Angeles, Chicago, San Francisco, etc.)
- Add international destinations (Berlin, Amsterdam, Tel Aviv)
- Bear business directory with reviews
- Event submission system
- Mobile app version
- Integration with bear social networks

## Contact

- **Website**: chunky.dad
- **Submissions**: Use the contact form for event and business information
- **Updates**: Follow our social media for the latest additions

## License

MIT License - feel free to use this as a template for community travel guides!

---

Made with ![chunky.dad logo](Rising_Star_Ryan_Head_Compressed.png) for the bear community. Travel safe, have fun, and support bear businesses!
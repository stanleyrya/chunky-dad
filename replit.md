# chunky.dad - Gay Bear Travel Guide

## Project Overview
A static website serving as the ultimate travel guide for the gay bear community. The site provides city guides, event calendars, and a directory of bear-owned businesses worldwide.

## Recent Changes (September 08, 2025)
- ✅ Successfully imported from GitHub and configured for Replit environment
- ✅ Set up Express.js server to serve static files on port 5000
- ✅ Configured workflow for development server with proper host settings
- ✅ Added deployment configuration for autoscale production deployment
- ✅ Verified website functionality with screenshot test

## Project Architecture
- **Frontend**: Pure HTML, CSS, and JavaScript static site
- **Server**: Express.js serving static files with cache control disabled for development
- **Build System**: Node.js based with npm package management
- **Deployment**: Autoscale deployment target configured for production

## Key Components
- **Main Site**: index.html with city guides and event listings
- **City Pages**: Individual pages for major bear destinations (New York, Los Angeles, etc.)
- **Event System**: Dynamic calendar loading and event aggregation
- **Business Directory**: Bear-owned business listings
- **Scripts**: Automation tools for event scraping and data management

## Dependencies
- express: Web server framework
- puppeteer: Web scraping for event data

## Development Workflow
- **Server**: `node server.js` on port 5000
- **Host**: 0.0.0.0 (required for Replit proxy)
- **Cache**: Disabled for development visibility

## Environment Configuration
- Port: 5000 (frontend)
- Host: 0.0.0.0 for development
- Cache control: Disabled for immediate updates
- Proxy: Trusted for Replit environment

## Current Status
✅ Fully functional and ready for development
✅ Deployment configured for production
✅ All workflows running successfully
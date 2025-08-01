// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: calendar-alt;
// 
// ============================================================================
// BEAR EVENT DISPLAY - ENHANCED SCRIPTABLE INTERFACE
// ============================================================================
// 🐻 Enhanced display for bear events with calendar preview and comparison
//
// Features:
// ✅ Calendar properties preview showing how events will be stored
// ✅ In-app rich display with detailed event information and enrichment
// ✅ Widget-optimized compact display for limited space
// ✅ Calendar reading and comparison before applying changes
// ✅ Available calendars debugging and listing
// ✅ Event data validation and conflict detection
// ============================================================================

console.log('🐻 Bear Event Display Enhanced - Starting...');

class BearEventDisplayEnhanced {
    constructor() {
        this.isWidget = config.runsInWidget;
        this.isApp = config.runsInApp;
        this.widgetSize = config.widgetFamily || 'medium';
        this.eventData = null;
        this.availableCalendars = [];
        this.calendarMappings = {};
    }

    async initialize() {
        try {
            console.log('🐻 Display: Initializing enhanced bear event display...');
            
            // Load configuration first
            await this.loadConfiguration();
            
            // Get available calendars for debugging
            await this.loadAvailableCalendars();
            
            // Load or simulate event data
            await this.loadEventData();
            
            console.log('🐻 Display: ✓ Initialization complete');
            
        } catch (error) {
            console.error(`🐻 Display: ✗ Initialization failed: ${error}`);
            throw error;
        }
    }

    async loadConfiguration() {
        try {
            const fm = FileManager.iCloud();
            const configPath = fm.joinPath(fm.documentsDirectory(), 'scraper-input.json');
            
            if (fm.fileExists(configPath)) {
                const configText = fm.readString(configPath);
                const config = JSON.parse(configText);
                this.calendarMappings = config.calendarMappings || {};
                console.log('🐻 Display: ✓ Configuration loaded');
            } else {
                console.log('🐻 Display: ⚠️ No configuration file found, using defaults');
                this.calendarMappings = {
                    'nyc': 'chunky-dad-nyc',
                    'la': 'chunky-dad-la',
                    'palm-springs': 'chunky-dad-palm-springs',
                    'seattle': 'chunky-dad-seattle',
                    'chicago': 'chunky-dad-chicago',
                    'toronto': 'chunky-dad-toronto',
                    'london': 'chunky-dad-london',
                    'berlin': 'chunky-dad-berlin',
                    'default': 'chunky-dad-events'
                };
            }
        } catch (error) {
            console.error(`🐻 Display: ✗ Configuration loading failed: ${error}`);
            throw error;
        }
    }

    async loadAvailableCalendars() {
        try {
            console.log('🐻 Display: Loading available calendars...');
            this.availableCalendars = await Calendar.forEvents();
            console.log(`🐻 Display: ✓ Found ${this.availableCalendars.length} calendars`);
            
            // Log calendar details for debugging
            this.availableCalendars.forEach((cal, i) => {
                console.log(`🐻 Display: Calendar ${i + 1}: "${cal.title}" (${cal.identifier})`);
                console.log(`🐻 Display:   - Color: ${cal.color.hex}`);
                console.log(`🐻 Display:   - Subscribed: ${cal.isSubscribed}`);
                console.log(`🐻 Display:   - Allows modifications: ${cal.allowsContentModifications}`);
            });
            
        } catch (error) {
            console.error(`🐻 Display: ✗ Failed to load calendars: ${error}`);
            this.availableCalendars = [];
        }
    }

    async loadEventData() {
        try {
            console.log('🐻 Display: Loading event data...');
            
            // For demo purposes, create sample events that match our calendar-core.js structure
            this.eventData = {
                events: [
                    {
                        name: 'Bearracuda NYC - Saturday Night Dance Party',
                        shortName: 'Bearracuda NYC',
                        shorterName: 'Bear',
                        bar: 'The Eagle NYC',
                        day: 'Saturday',
                        time: '10:00PM-4:00AM',
                        eventType: 'weekly',
                        recurring: true,
                        recurrence: 'FREQ=WEEKLY;BYDAY=SA',
                        startDate: new Date('2024-01-13T22:00:00'),
                        endDate: new Date('2024-01-14T04:00:00'),
                        coordinates: { lat: 40.7589, lng: -73.9851 },
                        cover: '$15 before 11pm, $20 after',
                        tea: 'NYC\'s hottest bear dance party! Featuring DJ sets, go-go dancers, and the friendliest crowd in the city.',
                        website: 'https://bearracuda.com/nyc',
                        instagram: 'https://instagram.com/bearracudanyc',
                        facebook: 'https://facebook.com/bearracudanyc',
                        gmaps: 'https://maps.google.com/?q=The+Eagle+NYC',
                        links: [
                            { type: 'website', url: 'https://bearracuda.com/nyc', label: '🌐 Website' },
                            { type: 'instagram', url: 'https://instagram.com/bearracudanyc', label: '📷 Instagram' }
                        ],
                        slug: 'bearracuda-nyc-saturday-night-dance-party',
                        citySlug: 'nyc',
                        city: 'nyc',
                        calendarTimezone: 'America/New_York',
                        startTimezone: 'America/New_York'
                    },
                    {
                        name: 'Megawoof America - Monthly Bear Pool Party',
                        shortName: 'Megawoof America',
                        shorterName: 'Mega',
                        bar: 'Pool Venue TBD',
                        day: 'Sunday',
                        time: '2:00PM-8:00PM',
                        eventType: 'monthly',
                        recurring: true,
                        recurrence: 'FREQ=MONTHLY;BYDAY=2SU',
                        startDate: new Date('2024-01-14T14:00:00'),
                        endDate: new Date('2024-01-14T20:00:00'),
                        coordinates: { lat: 34.0522, lng: -118.2437 },
                        cover: '$25 advance, $35 door',
                        tea: 'America\'s biggest bear pool party! Swimming, DJs, food trucks, and hundreds of bears from across the country.',
                        website: 'https://megawoof.com',
                        instagram: 'https://instagram.com/megawoofamerica',
                        links: [
                            { type: 'website', url: 'https://megawoof.com', label: '🌐 Website' },
                            { type: 'instagram', url: 'https://instagram.com/megawoofamerica', label: '📷 Instagram' }
                        ],
                        slug: 'megawoof-america-monthly-bear-pool-party',
                        citySlug: 'la',
                        city: 'la',
                        calendarTimezone: 'America/Los_Angeles',
                        startTimezone: 'America/Los_Angeles'
                    },
                    {
                        name: 'Bear Happy Hour at The Cubbyhole',
                        shortName: 'Bear Happy Hour',
                        shorterName: 'HH',
                        bar: 'The Cubbyhole',
                        day: 'Thursday',
                        time: '5:00PM-8:00PM',
                        eventType: 'weekly',
                        recurring: true,
                        recurrence: 'FREQ=WEEKLY;BYDAY=TH',
                        startDate: new Date('2024-01-11T17:00:00'),
                        endDate: new Date('2024-01-11T20:00:00'),
                        coordinates: { lat: 40.7341, lng: -74.0030 },
                        cover: 'Free',
                        tea: 'Casual Thursday night hangout for bears and cubs. $5 drinks during happy hour!',
                        website: 'https://cubbyholebarnyc.com',
                        links: [
                            { type: 'website', url: 'https://cubbyholebarnyc.com', label: '🌐 Website' }
                        ],
                        slug: 'bear-happy-hour-at-the-cubbyhole',
                        citySlug: 'nyc',
                        city: 'nyc',
                        calendarTimezone: 'America/New_York',
                        startTimezone: 'America/New_York'
                    }
                ],
                calendarMappings: this.calendarMappings,
                totalEvents: 3,
                bearEvents: 3,
                cities: ['nyc', 'la'],
                timezones: ['America/New_York', 'America/Los_Angeles']
            };
            
            console.log(`🐻 Display: ✓ Loaded ${this.eventData.events.length} sample events`);
            
        } catch (error) {
            console.error(`🐻 Display: ✗ Failed to load event data: ${error}`);
            this.eventData = { events: [], totalEvents: 0, bearEvents: 0 };
        }
    }

    async displayCalendarProperties() {
        console.log('\n' + '='.repeat(60));
        console.log('📅 CALENDAR PROPERTIES & STORAGE PREVIEW');
        console.log('='.repeat(60));
        
        if (!this.eventData || !this.eventData.events.length) {
            console.log('❌ No event data available for preview');
            return;
        }

        // Show how events will be stored
        this.eventData.events.forEach((event, i) => {
            console.log(`\n🐻 Event ${i + 1}: ${event.name}`);
            console.log('─'.repeat(40));
            
            // Calendar assignment
            const calendarName = this.calendarMappings[event.city] || `chunky-dad-${event.city}`;
            console.log(`📅 Target Calendar: "${calendarName}"`);
            
            // Check if calendar exists
            const existingCalendar = this.availableCalendars.find(cal => cal.title === calendarName);
            if (existingCalendar) {
                console.log(`✅ Calendar exists: ${existingCalendar.identifier}`);
                console.log(`   Color: ${existingCalendar.color.hex}`);
                console.log(`   Modifications allowed: ${existingCalendar.allowsContentModifications}`);
            } else {
                console.log(`🆕 Calendar will be created with orange color`);
            }
            
            // Event properties that will be stored
            console.log(`\n📋 CalendarEvent Properties:`);
            console.log(`   title: "${event.name}"`);
            console.log(`   startDate: ${event.startDate.toLocaleString()}`);
            console.log(`   endDate: ${event.endDate.toLocaleString()}`);
            console.log(`   location: "${event.bar}"`);
            console.log(`   timeZone: "${event.startTimezone || event.calendarTimezone}"`);
            console.log(`   isAllDay: false`);
            
            // Recurrence handling
            if (event.recurring && event.recurrence) {
                console.log(`   🔄 Recurrence: ${event.recurrence}`);
                console.log(`   Event Type: ${event.eventType}`);
            } else {
                console.log(`   🔄 Recurrence: None (one-time event)`);
            }
            
            // Notes field content
            const notes = this.formatEventNotes(event);
            console.log(`\n📝 Notes field content (${notes.length} chars):`);
            console.log(`"${notes.substring(0, 100)}${notes.length > 100 ? '...' : ''}"`);
            
            // Availability setting
            console.log(`\n⏰ Availability: busy`);
            
            // City and timezone info
            console.log(`\n🌍 Location Data:`);
            console.log(`   City: ${event.city}`);
            console.log(`   Coordinates: ${event.coordinates.lat}, ${event.coordinates.lng}`);
            console.log(`   Timezone: ${event.startTimezone || event.calendarTimezone}`);
        });
        
        console.log('\n' + '='.repeat(60));
    }

    formatEventNotes(event) {
        const notes = [];
        
        if (event.tea) {
            notes.push(event.tea);
        }
        
        if (event.cover && event.cover.toLowerCase() !== 'free') {
            notes.push(`Cover: ${event.cover}`);
        }
        
        // Add links
        if (event.links && event.links.length > 0) {
            notes.push('Links:');
            event.links.forEach(link => {
                notes.push(`${link.label}: ${link.url}`);
            });
        }
        
        // Add recurring info
        if (event.recurring) {
            notes.push(`Recurring: ${event.eventType} event`);
        }
        
        // Add source info
        notes.push(`Source: chunky.dad bear event scraper`);
        notes.push(`City: ${event.city}`);
        
        return notes.join('\n\n');
    }

    async compareWithExistingCalendars() {
        console.log('\n' + '='.repeat(60));
        console.log('🔍 CALENDAR COMPARISON & CONFLICT DETECTION');
        console.log('='.repeat(60));
        
        for (const event of this.eventData.events) {
            const calendarName = this.calendarMappings[event.city] || `chunky-dad-${event.city}`;
            const calendar = this.availableCalendars.find(cal => cal.title === calendarName);
            
            console.log(`\n🐻 Checking: ${event.name}`);
            console.log(`📅 Target Calendar: ${calendarName}`);
            
            if (!calendar) {
                console.log(`🆕 Calendar "${calendarName}" doesn't exist - will be created`);
                continue;
            }
            
            try {
                // Check for existing events in the time range
                const startDate = new Date(event.startDate);
                const endDate = new Date(event.endDate);
                
                // Expand search range for recurring events
                const searchStart = new Date(startDate);
                searchStart.setDate(searchStart.getDate() - 7); // Look back a week
                const searchEnd = new Date(endDate);
                searchEnd.setDate(searchEnd.getDate() + 30); // Look ahead a month
                
                const existingEvents = await CalendarEvent.between(searchStart, searchEnd, [calendar]);
                
                console.log(`📊 Found ${existingEvents.length} existing events in calendar`);
                
                // Check for exact duplicates
                const duplicates = existingEvents.filter(existing => {
                    const titleMatch = existing.title === event.name;
                    const timeMatch = Math.abs(existing.startDate.getTime() - startDate.getTime()) < 60000; // Within 1 minute
                    return titleMatch && timeMatch;
                });
                
                if (duplicates.length > 0) {
                    console.log(`⚠️  Found ${duplicates.length} potential duplicate(s):`);
                    duplicates.forEach(dup => {
                        console.log(`   - "${dup.title}" at ${dup.startDate.toLocaleString()}`);
                    });
                } else {
                    console.log(`✅ No duplicates found - safe to add`);
                }
                
                // Check for time conflicts (overlapping events)
                const conflicts = existingEvents.filter(existing => {
                    const existingStart = existing.startDate.getTime();
                    const existingEnd = existing.endDate.getTime();
                    const newStart = startDate.getTime();
                    const newEnd = endDate.getTime();
                    
                    // Check for overlap
                    return (newStart < existingEnd && newEnd > existingStart);
                });
                
                if (conflicts.length > 0) {
                    console.log(`⏰ Found ${conflicts.length} time conflict(s):`);
                    conflicts.forEach(conflict => {
                        console.log(`   - "${conflict.title}": ${conflict.startDate.toLocaleString()} - ${conflict.endDate.toLocaleString()}`);
                    });
                } else {
                    console.log(`✅ No time conflicts found`);
                }
                
            } catch (error) {
                console.error(`❌ Failed to check calendar "${calendarName}": ${error}`);
            }
        }
        
        console.log('\n' + '='.repeat(60));
    }

    async displayInApp() {
        console.log('\n' + '🐻 IN-APP ENHANCED DISPLAY');
        console.log('='.repeat(60));
        
        // Show calendar properties first
        await this.displayCalendarProperties();
        
        // Show comparison with existing calendars
        await this.compareWithExistingCalendars();
        
        // Show available calendars for debugging
        await this.displayAvailableCalendars();
        
        // Show enriched event information
        await this.displayEnrichedEvents();
        
        // Show summary and actions
        await this.displaySummaryAndActions();
    }

    async displayAvailableCalendars() {
        console.log('\n' + '='.repeat(60));
        console.log('📅 AVAILABLE CALENDARS (DEBUG INFO)');
        console.log('='.repeat(60));
        
        if (this.availableCalendars.length === 0) {
            console.log('❌ No calendars found or failed to load');
            return;
        }
        
        console.log(`📊 Total calendars: ${this.availableCalendars.length}\n`);
        
        this.availableCalendars.forEach((calendar, i) => {
            console.log(`📅 Calendar ${i + 1}: "${calendar.title}"`);
            console.log(`   ID: ${calendar.identifier}`);
            console.log(`   Color: ${calendar.color.hex}`);
            console.log(`   Subscribed: ${calendar.isSubscribed ? 'Yes' : 'No'}`);
            console.log(`   Modifications: ${calendar.allowsContentModifications ? 'Allowed' : 'Read-only'}`);
            console.log('');
        });
        
        // Show which calendars are mapped
        console.log('🗺️  Calendar Mappings:');
        Object.entries(this.calendarMappings).forEach(([city, calendarName]) => {
            const exists = this.availableCalendars.find(cal => cal.title === calendarName);
            const status = exists ? '✅ Exists' : '🆕 Will be created';
            console.log(`   ${city} → "${calendarName}" ${status}`);
        });
        
        console.log('\n' + '='.repeat(60));
    }

    async displayEnrichedEvents() {
        console.log('\n' + '='.repeat(60));
        console.log('🐻 ENRICHED EVENT INFORMATION');
        console.log('='.repeat(60));
        
        this.eventData.events.forEach((event, i) => {
            console.log(`\n🎉 Event ${i + 1}: ${event.name}`);
            console.log('─'.repeat(50));
            
            // Basic info
            console.log(`📍 Venue: ${event.bar}`);
            console.log(`📅 When: ${event.day} ${event.time}`);
            console.log(`🌍 City: ${event.city.toUpperCase()}`);
            console.log(`🕐 Timezone: ${event.startTimezone || event.calendarTimezone}`);
            
            // Event type and recurrence
            if (event.recurring) {
                console.log(`🔄 Type: ${event.eventType} recurring event`);
                console.log(`📋 Pattern: ${event.recurrence}`);
            } else {
                console.log(`📅 Type: One-time event`);
            }
            
            // Cover and pricing
            if (event.cover) {
                const coverIcon = event.cover.toLowerCase().includes('free') ? '🆓' : '💰';
                console.log(`${coverIcon} Cover: ${event.cover}`);
            }
            
            // Location with coordinates
            if (event.coordinates) {
                console.log(`🗺️  Coordinates: ${event.coordinates.lat}, ${event.coordinates.lng}`);
            }
            
            // Description/tea
            if (event.tea) {
                console.log(`\n☕ Description:`);
                console.log(`   ${event.tea}`);
            }
            
            // Links and social media
            if (event.links && event.links.length > 0) {
                console.log(`\n🔗 Links:`);
                event.links.forEach(link => {
                    console.log(`   ${link.label}: ${link.url}`);
                });
            }
            
            // Short names for display optimization
            if (event.shortName && event.shortName !== event.name) {
                console.log(`\n📱 Display Names:`);
                console.log(`   Short: "${event.shortName}"`);
                if (event.shorterName) {
                    console.log(`   Shorter: "${event.shorterName}"`);
                }
            }
            
            // Calendar event preview
            console.log(`\n📅 Calendar Event Preview:`);
            console.log(`   Title: "${event.name}"`);
            console.log(`   Start: ${event.startDate.toLocaleString()}`);
            console.log(`   End: ${event.endDate.toLocaleString()}`);
            console.log(`   Location: "${event.bar}"`);
            console.log(`   Notes: ${this.formatEventNotes(event).length} characters`);
        });
        
        console.log('\n' + '='.repeat(60));
    }

    async displaySummaryAndActions() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY & RECOMMENDED ACTIONS');
        console.log('='.repeat(60));
        
        const summary = {
            totalEvents: this.eventData.events.length,
            cities: [...new Set(this.eventData.events.map(e => e.city))],
            recurringEvents: this.eventData.events.filter(e => e.recurring).length,
            oneTimeEvents: this.eventData.events.filter(e => !e.recurring).length,
            calendarsNeeded: [...new Set(this.eventData.events.map(e => this.calendarMappings[e.city] || `chunky-dad-${e.city}`))],
            timezones: [...new Set(this.eventData.events.map(e => e.startTimezone || e.calendarTimezone))]
        };
        
        console.log(`📊 Events: ${summary.totalEvents} total`);
        console.log(`   🔄 Recurring: ${summary.recurringEvents}`);
        console.log(`   📅 One-time: ${summary.oneTimeEvents}`);
        console.log(`\n🌍 Cities: ${summary.cities.join(', ')}`);
        console.log(`📅 Calendars needed: ${summary.calendarsNeeded.length}`);
        summary.calendarsNeeded.forEach(cal => {
            const exists = this.availableCalendars.find(c => c.title === cal);
            console.log(`   - "${cal}" ${exists ? '(exists)' : '(will create)'}`);
        });
        
        console.log(`\n🕐 Timezones: ${summary.timezones.join(', ')}`);
        
        console.log(`\n🎯 Recommended Actions:`);
        console.log(`   1. Review calendar properties above`);
        console.log(`   2. Check for conflicts in comparison section`);
        console.log(`   3. Run bear-event-scraper-unified.js to apply changes`);
        console.log(`   4. Set dryRun: false in config to actually add events`);
        
        console.log('\n' + '='.repeat(60));
    }

    async displayInWidget() {
        const widget = new ListWidget();
        widget.backgroundColor = new Color('#8B4513'); // Brown bear color
        
        // Widget title
        const title = widget.addText('🐻 Bear Events');
        title.textColor = Color.white();
        title.font = Font.boldSystemFont(16);
        title.centerAlignText();
        
        widget.addSpacer(8);
        
        if (!this.eventData || !this.eventData.events.length) {
            const noEvents = widget.addText('No events loaded');
            noEvents.textColor = Color.white();
            noEvents.font = Font.systemFont(12);
            noEvents.centerAlignText();
            return widget;
        }
        
        // Show summary stats
        const stats = widget.addText(`${this.eventData.events.length} events ready`);
        stats.textColor = Color.white();
        stats.font = Font.systemFont(14);
        stats.centerAlignText();
        
        widget.addSpacer(4);
        
        // Show cities
        const cities = [...new Set(this.eventData.events.map(e => e.city))];
        const citiesText = widget.addText(`Cities: ${cities.join(', ').toUpperCase()}`);
        citiesText.textColor = Color.white();
        citiesText.font = Font.systemFont(10);
        citiesText.centerAlignText();
        
        widget.addSpacer(8);
        
        // Show next few events (compact)
        const upcomingEvents = this.eventData.events
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
            .slice(0, this.widgetSize === 'small' ? 2 : 4);
        
        upcomingEvents.forEach(event => {
            const eventRow = widget.addText(`${event.shortName || event.name}`);
            eventRow.textColor = Color.white();
            eventRow.font = Font.systemFont(9);
            eventRow.minimumScaleFactor = 0.8;
            
            const timeRow = widget.addText(`${event.day} ${event.time}`);
            timeRow.textColor = new Color('#FFE4B5'); // Light brown
            timeRow.font = Font.systemFont(8);
            
            widget.addSpacer(2);
        });
        
        // Add tap action to open full app
        widget.url = 'scriptable:///run/bear-event-display-enhanced';
        
        return widget;
    }

    async run() {
        try {
            await this.initialize();
            
            if (this.isWidget) {
                console.log('🐻 Display: Running in widget mode');
                const widget = await this.displayInWidget();
                Script.setWidget(widget);
                Script.complete();
            } else {
                console.log('🐻 Display: Running in app mode');
                await this.displayInApp();
                
                // Show completion notification
                const notification = new Notification();
                notification.title = '🐻 Bear Event Display';
                notification.body = `Displayed ${this.eventData.events.length} events with calendar preview`;
                notification.sound = 'default';
                await notification.schedule();
            }
            
        } catch (error) {
            console.error(`🐻 Display: ✗ Execution failed: ${error}`);
            
            // Show error alert
            const alert = new Alert();
            alert.title = '🐻 Bear Event Display Error';
            alert.message = `Failed to display events: ${error.message}`;
            alert.addAction('OK');
            await alert.present();
        }
    }
}

// Auto-execute
(async () => {
    const display = new BearEventDisplayEnhanced();
    await display.run();
})();
// Display Handler - Scriptable Environment
// Handles result formatting and display specifically for Scriptable iOS app

class ScriptableDisplayHandler {
    constructor(config = {}) {
        this.config = {
            maxEventsInNotification: config.maxEventsInNotification || 5,
            maxEventsInWidget: config.maxEventsInWidget || 3,
            includeCalendarExport: config.includeCalendarExport !== false,
            ...config
        };
    }

    // Display results as iOS notification
    async displayAsNotification(results, options = {}) {
        try {
            console.log('📱 Scriptable: Displaying results as notification');
            
            const notification = new Notification();
            notification.title = "🐻 Bear Event Scraper";
            
            if (results.bearEventCount === 0) {
                notification.body = "No bear events found in the search.";
                notification.sound = null;
            } else {
                const eventText = results.bearEventCount === 1 ? 'event' : 'events';
                notification.body = `Found ${results.bearEventCount} bear ${eventText}!`;
                
                // Add top events to notification body
                const topEvents = results.events.slice(0, this.config.maxEventsInNotification);
                const eventSummaries = topEvents.map(event => {
                    const date = event.date ? new Date(event.date).toLocaleDateString() : 'TBD';
                    return `• ${event.title} - ${date}`;
                }).join('\n');
                
                notification.body += `\n\n${eventSummaries}`;
                
                if (results.bearEventCount > this.config.maxEventsInNotification) {
                    const remaining = results.bearEventCount - this.config.maxEventsInNotification;
                    notification.body += `\n\n... and ${remaining} more events`;
                }
            }
            
            // Schedule the notification
            await notification.schedule();
            
            return {
                success: true,
                type: 'notification',
                eventsDisplayed: Math.min(results.bearEventCount, this.config.maxEventsInNotification)
            };
            
        } catch (error) {
            console.error('📱 Scriptable: Failed to display notification:', error);
            return {
                success: false,
                type: 'notification',
                error: error.message
            };
        }
    }

    // Display results as Scriptable widget
    async displayAsWidget(results, options = {}) {
        try {
            console.log('📱 Scriptable: Creating widget display');
            
            const widget = new ListWidget();
            widget.backgroundColor = new Color("#1a1a1a");
            
            // Header
            const header = widget.addText("🐻 Bear Events");
            header.textColor = Color.white();
            header.font = Font.boldSystemFont(16);
            widget.addSpacer(8);
            
            if (results.bearEventCount === 0) {
                const noEventsText = widget.addText("No bear events found");
                noEventsText.textColor = Color.gray();
                noEventsText.font = Font.systemFont(12);
            } else {
                // Show count
                const countText = widget.addText(`${results.bearEventCount} events found`);
                countText.textColor = Color.orange();
                countText.font = Font.systemFont(12);
                widget.addSpacer(4);
                
                // Show top events
                const topEvents = results.events.slice(0, this.config.maxEventsInWidget);
                
                for (const event of topEvents) {
                    const eventStack = widget.addStack();
                    eventStack.layoutVertically();
                    
                    // Event title
                    const titleText = eventStack.addText(event.title);
                    titleText.textColor = Color.white();
                    titleText.font = Font.boldSystemFont(10);
                    titleText.lineLimit = 1;
                    
                    // Event details
                    const date = event.date ? new Date(event.date).toLocaleDateString() : 'TBD';
                    const venue = event.venue || 'Venue TBD';
                    const detailsText = eventStack.addText(`${date} • ${venue}`);
                    detailsText.textColor = Color.gray();
                    detailsText.font = Font.systemFont(8);
                    detailsText.lineLimit = 1;
                    
                    widget.addSpacer(2);
                }
                
                if (results.bearEventCount > this.config.maxEventsInWidget) {
                    const remaining = results.bearEventCount - this.config.maxEventsInWidget;
                    const moreText = widget.addText(`... and ${remaining} more`);
                    moreText.textColor = Color.gray();
                    moreText.font = Font.systemFont(10);
                }
            }
            
            // Footer with timestamp
            widget.addSpacer();
            const timestamp = widget.addText(`Updated: ${new Date().toLocaleTimeString()}`);
            timestamp.textColor = Color.gray();
            timestamp.font = Font.systemFont(8);
            
            return {
                success: true,
                type: 'widget',
                widget: widget,
                eventsDisplayed: Math.min(results.bearEventCount, this.config.maxEventsInWidget)
            };
            
        } catch (error) {
            console.error('📱 Scriptable: Failed to create widget:', error);
            return {
                success: false,
                type: 'widget',
                error: error.message
            };
        }
    }

    // Export events to iOS Calendar
    async exportToCalendar(events, options = {}) {
        try {
            console.log(`📱 Scriptable: Exporting ${events.length} events to calendar`);
            
            const calendar = await Calendar.forEvents();
            let exportedCount = 0;
            
            for (const event of events) {
                if (!event.date) {
                    console.warn(`📱 Scriptable: Skipping event without date: ${event.title}`);
                    continue;
                }
                
                const calendarEvent = new CalendarEvent();
                calendarEvent.title = `🐻 ${event.title}`;
                calendarEvent.startDate = new Date(event.date);
                calendarEvent.endDate = new Date(new Date(event.date).getTime() + 2 * 60 * 60 * 1000); // 2 hours default
                calendarEvent.location = event.venue || '';
                calendarEvent.notes = `${event.description}\n\nSource: ${event.source}\nURL: ${event.url}`;
                calendarEvent.calendar = calendar;
                
                await calendarEvent.save();
                exportedCount++;
            }
            
            return {
                success: true,
                type: 'calendar',
                exportedCount: exportedCount,
                totalEvents: events.length
            };
            
        } catch (error) {
            console.error('📱 Scriptable: Failed to export to calendar:', error);
            return {
                success: false,
                type: 'calendar',
                error: error.message
            };
        }
    }

    // Generate text summary for sharing
    generateTextSummary(results, options = {}) {
        try {
            let summary = `🐻 Bear Event Scraper Results\n`;
            summary += `Found ${results.bearEventCount} bear events\n`;
            summary += `Searched ${results.totalSources} sources\n\n`;
            
            if (results.bearEventCount > 0) {
                results.events.forEach((event, index) => {
                    const date = event.date ? new Date(event.date).toLocaleDateString() : 'TBD';
                    summary += `${index + 1}. ${event.title}\n`;
                    summary += `   📅 ${date}\n`;
                    if (event.venue) summary += `   📍 ${event.venue}\n`;
                    if (event.city && event.city !== 'unknown') summary += `   🏙️ ${event.city.toUpperCase()}\n`;
                    summary += `   🔗 ${event.source}\n\n`;
                });
            }
            
            summary += `Generated: ${new Date().toLocaleString()}\n`;
            summary += `chunky.dad bear event scraper`;
            
            return {
                success: true,
                type: 'text',
                content: summary
            };
            
        } catch (error) {
            console.error('📱 Scriptable: Failed to generate text summary:', error);
            return {
                success: false,
                type: 'text',
                error: error.message
            };
        }
    }

    // Enhanced console display with visual formatting
    displayEnhancedConsole(results, options = {}) {
        console.log('\n' + '='.repeat(60));
        console.log('🐻 BEAR EVENT SCRAPER RESULTS 🐻');
        console.log('='.repeat(60));
        
        // Main stats with visual formatting
        const statsEmoji = results.bearEventCount > 0 ? '🎉' : '😔';
        console.log(`${statsEmoji} SUMMARY:`);
        console.log(`   📅 Total Events Found: ${results.events.length}`);
        console.log(`   🐻 Bear Events: ${results.bearEventCount}`);
        console.log(`   📊 Sources: ${results.successfulSources}/${results.totalSources} successful`);
        
        if (results.processingStats) {
            console.log(`   🔄 Duplicates Removed: ${results.processingStats.duplicatesRemoved}`);
            console.log(`   ⏰ Past Events Filtered: ${results.processingStats.pastEventsFiltered}`);
        }
        
        // Show upcoming events with enhanced formatting
        if (results.bearEventCount > 0) {
            console.log('\n🗓️ UPCOMING BEAR EVENTS:');
            console.log('-'.repeat(40));
            
            const upcomingEvents = results.events
                .filter(event => event.isBearEvent)
                .slice(0, 5); // Show top 5
            
            upcomingEvents.forEach((event, index) => {
                const eventNumber = `${index + 1}.`.padEnd(3);
                const title = event.title || 'Untitled Event';
                const venue = event.venue ? ` @ ${event.venue}` : '';
                const city = event.city ? ` (${event.city.toUpperCase()})` : '';
                const date = event.date ? new Date(event.date).toLocaleDateString() : 'TBD';
                
                console.log(`   ${eventNumber}🎪 ${title}${venue}${city}`);
                console.log(`      📅 ${date}`);
                if (event.url) {
                    console.log(`      🔗 ${event.url}`);
                }
                console.log('');
            });
            
            if (results.bearEventCount > 5) {
                console.log(`   ... and ${results.bearEventCount - 5} more events! 🎊`);
            }
        } else {
            console.log('\n😢 No bear events found in this search.');
            console.log('   Try expanding your search criteria or check back later!');
        }
        
        // Enhanced statistics display
        if (results.comprehensiveStats) {
            console.log('\n📈 DETAILED STATISTICS:');
            console.log('-'.repeat(40));
            const stats = results.comprehensiveStats;
            
            if (stats.totals) {
                console.log(`   🔍 Processing Success: ${stats.overallSuccessRate || 0}%`);
                console.log(`   🐻 Bear Event Rate: ${stats.overallBearEventRate || 0}%`);
            }
            
            // Source performance with visual indicators
            if (stats.sourcePerformance && stats.sourcePerformance.length > 0) {
                console.log('\n🏆 SOURCE PERFORMANCE:');
                stats.sourcePerformance.forEach(source => {
                    const successIcon = source.successRate > 80 ? '🟢' : source.successRate > 50 ? '🟡' : '🔴';
                    console.log(`   ${successIcon} ${source.source}: ${source.validEvents}/${source.totalParsed} events (${source.successRate}% success)`);
                });
            }
            
            // Top bear keywords with fun emojis
            if (stats.bearKeywordMatches && Object.keys(stats.bearKeywordMatches).length > 0) {
                console.log('\n🐻 TOP BEAR KEYWORDS:');
                const topKeywords = Object.entries(stats.bearKeywordMatches)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 5);
                topKeywords.forEach(([keyword, count]) => {
                    const keywordEmoji = this.getKeywordEmoji(keyword);
                    console.log(`   ${keywordEmoji} "${keyword}": ${count} matches`);
                });
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🎯 Scraping completed successfully!');
        console.log('='.repeat(60) + '\n');
        
        return {
            success: true,
            type: 'enhanced-console',
            eventsDisplayed: results.bearEventCount
        };
    }
    
    // Get appropriate emoji for keywords
    getKeywordEmoji(keyword) {
        const keywordLower = keyword.toLowerCase();
        if (keywordLower.includes('bear')) return '🐻';
        if (keywordLower.includes('daddy')) return '👨‍🦳';
        if (keywordLower.includes('cub')) return '🐻‍❄️';
        if (keywordLower.includes('leather')) return '🖤';
        if (keywordLower.includes('muscle')) return '💪';
        if (keywordLower.includes('party') || keywordLower.includes('dance')) return '🎉';
        if (keywordLower.includes('woof')) return '🐺';
        return '🏷️';
    }

    // Main display method that chooses appropriate format
    async displayResults(results, options = {}) {
        const format = options.format || 'enhanced-console';
        
        switch (format) {
            case 'notification':
                return await this.displayAsNotification(results, options);
            case 'widget':
                return await this.displayAsWidget(results, options);
            case 'calendar':
                return await this.exportToCalendar(results.events, options);
            case 'text':
                return this.generateTextSummary(results, options);
            case 'enhanced-console':
                return this.displayEnhancedConsole(results, options);
            default:
                console.warn(`📱 Scriptable: Unknown display format: ${format}, using enhanced-console`);
                return this.displayEnhancedConsole(results, options);
        }
    }
}

// Export for Scriptable environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScriptableDisplayHandler };
} else {
    // Make available globally for Scriptable
    this.ScriptableDisplayHandler = ScriptableDisplayHandler;
}
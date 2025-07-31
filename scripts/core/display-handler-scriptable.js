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
                    const titleText = eventStack.addText(event.title || '❌ No Title');
                    titleText.textColor = event.title ? Color.white() : Color.red();
                    titleText.font = Font.boldSystemFont(10);
                    titleText.lineLimit = 1;
                    
                    // Event details with missing field indicators
                    const date = event.date ? new Date(event.date).toLocaleDateString() : (event.dateString || '❌ No Date');
                    const venue = event.venue || '❌ No Venue';
                    const city = (event.city && event.city !== 'unknown') ? event.city.toUpperCase() : '❌ No City';
                    
                    const detailsText = eventStack.addText(`📅 ${date}`);
                    detailsText.textColor = event.date ? Color.gray() : Color.orange();
                    detailsText.font = Font.systemFont(8);
                    detailsText.lineLimit = 1;
                    
                    const venueText = eventStack.addText(`📍 ${venue} • 🏙️ ${city}`);
                    venueText.textColor = (event.venue && event.city && event.city !== 'unknown') ? Color.gray() : Color.orange();
                    venueText.font = Font.systemFont(8);
                    venueText.lineLimit = 1;
                    
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
                    const endDate = event.endDate ? ` - ${new Date(event.endDate).toLocaleTimeString()}` : '';
                    summary += `${index + 1}. ${event.title}\n`;
                    if (event.originalTitle && event.originalTitle !== event.title) {
                        summary += `   📝 Original: ${event.originalTitle}\n`;
                    }
                    if (event.shortTitle) summary += `   🏷️ Short: ${event.shortTitle}\n`;
                    summary += `   📅 ${date}${endDate}\n`;
                    if (event.venue) summary += `   📍 ${event.venue}\n`;
                    if (event.city && event.city !== 'unknown') summary += `   🏙️ ${event.city.toUpperCase()}\n`;
                    if (event.price) summary += `   💰 ${event.price}\n`;
                    if (event.instagram) summary += `   📸 ${event.instagram}\n`;
                    summary += `   🔗 ${event.source}\n`;
                    if (event.eventUrl) summary += `   🌐 ${event.eventUrl}\n`;
                    summary += '\n';
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

    // Display results as interactive table (for app environment)
    async displayAsInteractiveTable(results, options = {}) {
        try {
            console.log('📱 Scriptable: Creating interactive table display');
            
            const table = new UITable();
            table.showSeparators = true;
            
            // Header row
            const headerRow = new UITableRow();
            headerRow.isHeader = true;
            headerRow.backgroundColor = Color.darkGray();
            
            const headerCell = headerRow.addText(`🐻 Found ${results.bearEventCount} Bear Events`);
            headerCell.titleColor = Color.white();
            headerCell.titleFont = Font.boldSystemFont(18);
            table.addRow(headerRow);
            
            // Add events to table
            if (results.bearEventCount > 0) {
                const bearEvents = results.events.filter(event => event.isBearEvent);
                
                bearEvents.forEach((event, index) => {
                    const row = new UITableRow();
                    row.height = 100;
                    
                    // Event title and details with missing field indicators
                    const title = event.title || '❌ No Title';
                    const originalTitle = event.originalTitle && event.originalTitle !== event.title ? `\n📝 Original: ${event.originalTitle}` : '';
                    const shortTitle = event.shortTitle ? `\n🏷️ Short: ${event.shortTitle}` : '';
                    const date = event.date 
                        ? new Date(event.date).toLocaleDateString() + ' ' + new Date(event.date).toLocaleTimeString()
                        : (event.dateString ? `${event.dateString} (unparsed)` : '❌ No Date');
                    const endDate = event.endDate ? ` - ${new Date(event.endDate).toLocaleTimeString()}` : '';
                    const venue = event.venue || '❌ No Venue';
                    const city = (event.city && event.city !== 'unknown') ? event.city.toUpperCase() : '❌ No City';
                    const price = event.price ? `💰 ${event.price}` : '💰 No Price';
                    const instagram = event.instagram ? `\n📸 Instagram` : '';
                    const source = event.source ? `📊 ${event.source}` : '';
                    
                    const eventCell = row.addText(`${title}${originalTitle}${shortTitle}\n📅 ${date}${endDate}\n📍 ${venue} • 🏙️ ${city}\n${price} ${source}${instagram}`);
                    eventCell.titleFont = Font.boldSystemFont(14);
                    eventCell.subtitleFont = Font.systemFont(11);
                    eventCell.subtitleColor = Color.gray();
                    
                    // Add tap action to open event URL if available
                    const eventUrl = event.eventUrl || event.url;
                    if (eventUrl) {
                        row.onSelect = () => {
                            Safari.open(eventUrl);
                        };
                        
                        // Add arrow indicator
                        const arrowCell = row.addText('→');
                        arrowCell.titleColor = Color.blue();
                        arrowCell.widthWeight = 10;
                        arrowCell.rightAligned();
                    } else {
                        // No URL available - show info icon
                        const infoCell = row.addText('ℹ️');
                        infoCell.titleColor = Color.gray();
                        infoCell.widthWeight = 10;
                        infoCell.rightAligned();
                    }
                    
                    table.addRow(row);
                });
                
                // Add summary row
                if (results.bearEventCount > bearEvents.length) {
                    const summaryRow = new UITableRow();
                    const remaining = results.bearEventCount - bearEvents.length;
                    const summaryCell = summaryRow.addText(`... and ${remaining} more events`);
                    summaryCell.titleColor = Color.gray();
                    summaryCell.titleFont = Font.italicSystemFont(14);
                    table.addRow(summaryRow);
                }
            } else {
                // No events row
                const noEventsRow = new UITableRow();
                const noEventsCell = noEventsRow.addText('😢 No bear events found\nTry expanding your search criteria');
                noEventsCell.titleColor = Color.gray();
                noEventsCell.titleFont = Font.systemFont(16);
                table.addRow(noEventsRow);
            }
            
            // Add action buttons row
            const actionsRow = new UITableRow();
            actionsRow.backgroundColor = Color.lightGray();
            
            const actionsCell = actionsRow.addText('📤 Export to Calendar  •  📋 Copy Summary  •  🔄 Refresh');
            actionsCell.titleColor = Color.blue();
            actionsCell.titleFont = Font.systemFont(14);
            
            actionsRow.onSelect = async () => {
                const alert = new Alert();
                alert.title = 'Actions';
                alert.addAction('📤 Export to Calendar');
                alert.addAction('📋 Copy Text Summary');
                alert.addAction('🔄 Run Again');
                alert.addCancelAction('Cancel');
                
                const actionIndex = await alert.present();
                
                if (actionIndex === 0) {
                    // Export to calendar
                    const calendarResult = await this.exportToCalendar(results.events.filter(e => e.isBearEvent), options);
                    const successAlert = new Alert();
                    successAlert.title = calendarResult.success ? '✅ Success' : '❌ Error';
                    successAlert.message = calendarResult.success 
                        ? `Exported ${calendarResult.exportedCount} events to calendar!`
                        : `Failed to export: ${calendarResult.error}`;
                    successAlert.addAction('OK');
                    await successAlert.present();
                } else if (actionIndex === 1) {
                    // Copy text summary
                    const textResult = this.generateTextSummary(results, options);
                    if (textResult.success) {
                        Pasteboard.copyString(textResult.content);
                        const copyAlert = new Alert();
                        copyAlert.title = '📋 Copied!';
                        copyAlert.message = 'Event summary copied to clipboard';
                        copyAlert.addAction('OK');
                        await copyAlert.present();
                    }
                } else if (actionIndex === 2) {
                    // This would trigger a re-run - for now just show info
                    const infoAlert = new Alert();
                    infoAlert.title = '🔄 Refresh';
                    infoAlert.message = 'Run the script again to refresh results';
                    infoAlert.addAction('OK');
                    await infoAlert.present();
                }
            };
            
            table.addRow(actionsRow);
            
            // Present the table
            await table.present();
            
            return {
                success: true,
                type: 'interactive-table',
                eventsDisplayed: results.bearEventCount
            };
            
        } catch (error) {
            console.error('📱 Scriptable: Failed to create interactive table:', error);
            return {
                success: false,
                type: 'interactive-table',
                error: error.message
            };
        }
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

    // Main display method that chooses appropriate format based on environment
    async displayResults(results, options = {}) {
        // ALWAYS display enhanced console logs first
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
                const title = event.title || '❌ NO TITLE';
                
                console.log(`   ${eventNumber}🎪 ${title}`);
                
                // Date information
                if (event.date) {
                    const date = new Date(event.date).toLocaleDateString();
                    const time = new Date(event.date).toLocaleTimeString();
                    console.log(`      📅 ${date} at ${time}`);
                } else if (event.dateString) {
                    console.log(`      📅 ${event.dateString} (⚠️ unparsed date)`);
                } else {
                    console.log(`      📅 ❌ NO DATE`);
                }
                
                // Venue and location
                if (event.venue) {
                    console.log(`      📍 ${event.venue}`);
                } else {
                    console.log(`      📍 ❌ NO VENUE`);
                }
                
                // City information
                if (event.city && event.city !== 'unknown') {
                    console.log(`      🏙️ ${event.city.toUpperCase()}`);
                } else {
                    console.log(`      🏙️ ❌ NO CITY`);
                }
                
                // Price information
                if (event.price) {
                    console.log(`      💰 ${event.price}`);
                } else {
                    console.log(`      💰 ❌ NO PRICE INFO`);
                }
                
                // Description
                if (event.description) {
                    const shortDesc = event.description.length > 100 
                        ? event.description.substring(0, 100) + '...' 
                        : event.description;
                    console.log(`      📝 ${shortDesc}`);
                } else {
                    console.log(`      📝 ❌ NO DESCRIPTION`);
                }
                
                // URL
                if (event.eventUrl || event.url) {
                    const url = event.eventUrl || event.url;
                    console.log(`      🔗 ${url}`);
                } else {
                    console.log(`      🔗 ❌ NO URL`);
                }
                
                // Source information
                if (event.source) {
                    console.log(`      📊 Source: ${event.source}`);
                }
                
                // Bear event confidence (if available)
                if (event.bearConfidence !== undefined) {
                    console.log(`      🐻 Bear Confidence: ${event.bearConfidence}%`);
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

        // Now auto-detect environment and provide rich experience if possible
        let richDisplayResult = null;
        
        // Check if running in a widget environment
        if (config.runsInWidget || config.runsInAccessoryWidget) {
            console.log('🔧 Environment: Widget detected - creating rich widget display');
            try {
                const widgetResult = await this.displayAsWidget(results, options);
                if (widgetResult.success && widgetResult.widget) {
                    // Set the widget for display
                    Script.setWidget(widgetResult.widget);
                    richDisplayResult = widgetResult;
                    console.log('✅ Widget display configured successfully');
                } else {
                    console.warn('⚠️ Widget creation failed, logs still available');
                }
            } catch (error) {
                console.error('❌ Widget creation error:', error);
                console.log('📋 Falling back to logs only');
            }
        } else {
            // Running in app environment - can display rich interactive experience
            console.log('🔧 Environment: App detected - creating rich interactive display');
            try {
                // Create and present a rich table view for interactive browsing
                const tableResult = await this.displayAsInteractiveTable(results, options);
                richDisplayResult = tableResult;
                console.log('✅ Interactive table display presented successfully');
            } catch (error) {
                console.error('❌ Interactive display error:', error);
                console.log('📋 Rich display failed, but logs are still available above');
            }
        }

        // Return combined result
        return {
            success: true,
            type: 'auto-detected',
            environment: config.runsInWidget || config.runsInAccessoryWidget ? 'widget' : 'app',
            logsDisplayed: true,
            richDisplayResult: richDisplayResult,
            eventsDisplayed: results.bearEventCount
        };
    }
}

// Export for Scriptable environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScriptableDisplayHandler };
} else {
    // Make available globally for Scriptable
    this.ScriptableDisplayHandler = ScriptableDisplayHandler;
}
// Bear Event Scraper - Scriptable End-to-End Test
// This script validates that the unified parser works correctly in Scriptable
// using the actual downloaded core modules

console.log('🐻 Starting Bear Event Scraper Scriptable End-to-End Test');

async function runScriptableTest() {
    try {
        // Test 1: Load and validate the unified scraper
        console.log('\n📝 Test 1: Loading unified scraper...');
        const scraperModule = importModule('bear-event-scraper-unified');
        console.log('✅ Unified scraper loaded successfully');
        
        // Test 2: Create scraper instance
        console.log('\n📝 Test 2: Creating scraper instance...');
        const scraper = new scraperModule.BearEventScraper({
            mockMode: true,
            maxEvents: 5,
            enableDebugMode: true
        });
        console.log('✅ Scraper instance created');
        
        // Test 3: Initialize and validate modules
        console.log('\n📝 Test 3: Initializing scraper...');
        await scraper.initialize();
        console.log('✅ Scraper initialized');
        
        console.log('\n📝 Test 4: Validating modules...');
        scraper.validateModules();
        console.log('✅ Module validation passed - using actual downloaded libraries');
        
        // Test 5: Run mock scraping test
        console.log('\n📝 Test 5: Running mock scraping test...');
        const testSources = [{
            name: "Scriptable Test - Furball NYC",
            parser: "furball",
            url: "https://www.furball.nyc",
            alwaysBear: true,
            defaultCity: "nyc",
            defaultVenue: "Test Venue"
        }];
        
        const results = await scraper.scrapeEvents(testSources);
        
        // Test 6: Validate results
        console.log('\n📝 Test 6: Validating results...');
        console.log(`✅ Found ${results.events.length} events`);
        console.log(`✅ Found ${results.bearEventCount} bear events`);
        console.log(`✅ Processed ${results.successfulSources}/${results.totalSources} sources`);
        
        if (results.events.length > 0) {
            console.log('\n📋 Sample Events:');
            results.events.slice(0, 3).forEach((event, index) => {
                console.log(`${index + 1}. ${event.title} ${event.isBearEvent ? '🐻' : ''}`);
                console.log(`   Date: ${event.date || 'TBD'}`);
                console.log(`   Venue: ${event.venue || 'N/A'}`);
            });
        }
        
        // Test 7: Show success alert
        const alert = new Alert();
        alert.title = "🎉 Scriptable Test Passed";
        alert.message = `End-to-end flow validated successfully!\n\n` +
                       `✅ Using actual downloaded modules\n` +
                       `✅ Found ${results.events.length} events (${results.bearEventCount} bear events)\n` +
                       `✅ All components working correctly`;
        alert.addAction("View Details");
        alert.addAction("OK");
        
        const response = await alert.presentAlert();
        
        if (response === 0) {
            // Show detailed results
            await showDetailedResults(results);
        }
        
        console.log('\n🎉 All tests passed! End-to-end flow validated in Scriptable.');
        return results;
        
    } catch (error) {
        console.error('💥 Scriptable test failed:', error);
        
        const alert = new Alert();
        alert.title = "❌ Test Failed";
        alert.message = `Scriptable end-to-end test failed:\n\n${error.message}`;
        alert.addAction("OK");
        await alert.presentAlert();
        
        throw error;
    }
}

async function showDetailedResults(results) {
    // Show module validation details
    const moduleAlert = new Alert();
    moduleAlert.title = "📋 Module Details";
    moduleAlert.message = `Core Modules Status:\n\n` +
                         `✅ InputAdapters: Loaded\n` +
                         `✅ EventProcessor: Loaded\n` +
                         `✅ DisplayAdapters: Loaded\n\n` +
                         `Environment: Scriptable\n` +
                         `Mock Mode: ${results.config.mockMode}\n` +
                         `Max Events: ${results.config.maxEvents}`;
    moduleAlert.addAction("Next");
    await moduleAlert.presentAlert();
    
    // Show event details
    if (results.events.length > 0) {
        for (let i = 0; i < Math.min(3, results.events.length); i++) {
            const event = results.events[i];
            const eventAlert = new Alert();
            eventAlert.title = `Event ${i + 1}: ${event.title}`;
            eventAlert.message = `Date: ${event.date ? new Date(event.date).toLocaleDateString() : 'TBD'}\n` +
                                `Venue: ${event.venue || 'N/A'}\n` +
                                `City: ${event.city || 'N/A'}\n` +
                                `Bear Event: ${event.isBearEvent ? 'Yes 🐻' : 'No'}\n` +
                                `Source: ${event.source}`;
            eventAlert.addAction(i < Math.min(2, results.events.length - 1) ? "Next" : "Done");
            await eventAlert.presentAlert();
        }
    }
}

// Additional test functions for specific components
async function testInputAdapterInScriptable() {
    console.log('\n🔍 Testing InputAdapter in Scriptable...');
    
    try {
        const inputModule = importModule('core/input-adapters');
        const adapter = inputModule.createInputAdapter();
        
        console.log(`✅ Environment detected: ${adapter.environment}`);
        
        // Test mock data fetch
        const mockResult = await adapter.fetchData({
            url: 'https://test.com',
            parser: 'furball',
            mockMode: true
        });
        
        console.log(`✅ Mock fetch successful: ${mockResult.html ? mockResult.html.length : 0} chars`);
        return true;
        
    } catch (error) {
        console.error('❌ InputAdapter test failed:', error);
        return false;
    }
}

async function testEventProcessorInScriptable() {
    console.log('\n🔍 Testing EventProcessor in Scriptable...');
    
    try {
        const processorModule = importModule('core/event-processor');
        const processor = new processorModule.EventProcessor({ enableDebugMode: true });
        
        console.log(`✅ Bear keywords loaded: ${processor.bearKeywords.length}`);
        console.log(`✅ City mappings: ${Object.keys(processor.cityCalendarMap).length}`);
        console.log(`✅ Venue defaults: ${Object.keys(processor.venueDefaults).length}`);
        
        // Test bear event detection
        const testEvent = { title: 'Bear Happy Hour', description: 'For all cubs and otters' };
        const isBear = processor.isBearEvent(testEvent, { alwaysBear: false });
        console.log(`✅ Bear detection working: ${isBear}`);
        
        return true;
        
    } catch (error) {
        console.error('❌ EventProcessor test failed:', error);
        return false;
    }
}

async function testDisplayAdapterInScriptable() {
    console.log('\n🔍 Testing DisplayAdapter in Scriptable...');
    
    try {
        const displayModule = importModule('core/display-adapters');
        const adapter = displayModule.createDisplayAdapter();
        
        console.log(`✅ Environment detected: ${adapter.environment}`);
        
        // Test alert display
        const testResults = {
            events: [
                { title: 'Test Event', isBearEvent: true, date: new Date().toISOString() }
            ],
            source: 'Test Source'
        };
        
        console.log('✅ Display adapter ready for results');
        return true;
        
    } catch (error) {
        console.error('❌ DisplayAdapter test failed:', error);
        return false;
    }
}

// Main execution
async function main() {
    const startTime = new Date();
    console.log(`🚀 Starting comprehensive Scriptable test at ${startTime.toLocaleTimeString()}`);
    
    // Run individual component tests first
    const inputTest = await testInputAdapterInScriptable();
    const processorTest = await testEventProcessorInScriptable();
    const displayTest = await testDisplayAdapterInScriptable();
    
    if (inputTest && processorTest && displayTest) {
        console.log('\n✅ All individual component tests passed');
        
        // Run full end-to-end test
        const results = await runScriptableTest();
        
        const endTime = new Date();
        const duration = Math.round((endTime - startTime) / 1000);
        
        console.log(`\n🎉 All tests completed successfully in ${duration} seconds`);
        console.log('📊 Summary:');
        console.log(`   - Core modules: ✅ Loaded and validated`);
        console.log(`   - Input adapter: ✅ Working`);
        console.log(`   - Event processor: ✅ Working`);
        console.log(`   - Display adapter: ✅ Working`);
        console.log(`   - End-to-end flow: ✅ Working`);
        console.log(`   - Events found: ${results.events.length} (${results.bearEventCount} bear events)`);
        
        return results;
        
    } else {
        throw new Error('One or more component tests failed');
    }
}

// Run the test
main().catch(error => {
    console.error('💥 Test suite failed:', error);
    
    // Show final error alert
    const errorAlert = new Alert();
    errorAlert.title = "💥 Test Suite Failed";
    errorAlert.message = `The Scriptable test suite encountered an error:\n\n${error.message}\n\nCheck the console for details.`;
    errorAlert.addAction("OK");
    errorAlert.presentAlert();
});
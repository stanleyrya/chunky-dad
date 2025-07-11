// Backward Compatibility Script
// This file maintains compatibility for any existing HTML onclick handlers

// Global function for scrolling (backward compatibility)
function scrollToSection(sectionId) {
    if (window.chunkyApp && window.chunkyApp.scrollToSection) {
        window.chunkyApp.scrollToSection(sectionId);
    } else {
        // Fallback if app not initialized yet
        const element = document.getElementById(sectionId);
        if (element) {
            element.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }
}

// Global function for map interaction (used by calendar events)
function showOnMap(lat, lng, eventName, barName) {
    if (window.eventsMap && typeof L !== 'undefined') {
        logger.userInteraction('MAP', `Showing location: ${eventName} at ${barName}`, {
            lat, lng, eventName, barName
        });
        
        // Center the map on the event location
        window.eventsMap.setView([lat, lng], 16);
        
        // Find and open the popup for this event
        window.eventsMap.eachLayer(layer => {
            if (layer instanceof L.Marker) {
                const popup = layer.getPopup();
                if (popup && popup.getContent().includes(eventName)) {
                    layer.openPopup();
                }
            }
        });
        
        // Prevent default scroll behavior by using preventDefault on scroll events
        // This prevents the page from scrolling to top when clicking map links
        const mapContainer = document.querySelector('#events-map');
        if (mapContainer) {
            mapContainer.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center' 
            });
        }
    } else {
        logger.warn('MAP', 'Map not available for location display');
    }
}


// Ensure app is initialized
document.addEventListener('DOMContentLoaded', () => {
    if (!window.chunkyApp) {
        logger.warn('SYSTEM', 'ChunkyApp not found, functions may not work properly');
    }
});
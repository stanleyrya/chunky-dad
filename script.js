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

// Global function for map fullscreen toggle (cross-browser compatible)
function toggleFullscreen() {
    const mapContainer = document.querySelector('.map-container');
    if (!mapContainer) {
        logger.warn('MAP', 'Map container not found for fullscreen toggle');
        return;
    }
    
    logger.userInteraction('MAP', 'Fullscreen toggle requested');
    
    // Check if already in fullscreen
    if (document.fullscreenElement || 
        document.webkitFullscreenElement || 
        document.mozFullScreenElement ||
        document.msFullscreenElement) {
        
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
        
        logger.userInteraction('MAP', 'Exited fullscreen mode');
        
    } else {
        // Enter fullscreen
        if (mapContainer.requestFullscreen) {
            mapContainer.requestFullscreen();
        } else if (mapContainer.webkitRequestFullscreen) {
            mapContainer.webkitRequestFullscreen();
        } else if (mapContainer.mozRequestFullScreen) {
            mapContainer.mozRequestFullScreen();
        } else if (mapContainer.msRequestFullscreen) {
            mapContainer.msRequestFullscreen();
        } else {
            // Fallback for iOS Safari and other browsers that don't support fullscreen
            logger.warn('MAP', 'Fullscreen not supported on this device, using zoom fallback');
            
            // For iOS Safari, create a modal-like experience
            mapContainer.classList.add('map-fullscreen-fallback');
            
            // Add close button
            const closeButton = document.createElement('button');
            closeButton.innerHTML = '✕';
            closeButton.className = 'map-fullscreen-close';
            closeButton.onclick = () => {
                mapContainer.classList.remove('map-fullscreen-fallback');
                closeButton.remove();
                // Resize map after closing
                setTimeout(() => {
                    if (window.eventsMap) {
                        window.eventsMap.invalidateSize();
                    }
                }, 300);
            };
            mapContainer.appendChild(closeButton);
            
            // Resize map after entering fullscreen fallback
            setTimeout(() => {
                if (window.eventsMap) {
                    window.eventsMap.invalidateSize();
                }
            }, 300);
            
            return;
        }
        
        logger.userInteraction('MAP', 'Entered fullscreen mode');
    }
    
    // Handle fullscreen change events
    const handleFullscreenChange = () => {
        if (window.eventsMap) {
            // Resize map when fullscreen changes
            setTimeout(() => {
                window.eventsMap.invalidateSize();
            }, 300);
        }
    };
    
    // Add listeners for fullscreen change events
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
}

// Ensure app is initialized
document.addEventListener('DOMContentLoaded', () => {
    if (!window.chunkyApp) {
        logger.warn('SYSTEM', 'ChunkyApp not found, functions may not work properly');
    }
});
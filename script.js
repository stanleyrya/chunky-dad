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
        logger.userInteraction('MAP', `Showing location: ${eventName} at ${barName}`);
        
        // First scroll to the map section
        const mapSection = document.querySelector('.events-map-section');
        if (mapSection) {
            mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Then center the map on the location with a slight delay
        setTimeout(() => {
            window.eventsMap.setView([lat, lng], 16);
            
            // Find and open the popup for this event
            window.eventsMap.eachLayer(layer => {
                if (layer instanceof L.Marker) {
                    const latLng = layer.getLatLng();
                    if (Math.abs(latLng.lat - lat) < 0.0001 && Math.abs(latLng.lng - lng) < 0.0001) {
                        layer.openPopup();
                    }
                }
            });
        }, 300);
    } else {
        logger.warn('MAP', 'Map not available for location display');
    }
}

// Map control functions (global for HTML onclick handlers)
function fitAllMarkers() {
    if (window.eventsMap && window.eventsMapMarkers && window.eventsMapMarkers.length > 0) {
        const group = new L.featureGroup(window.eventsMapMarkers);
        window.eventsMap.fitBounds(group.getBounds().pad(0.1));
        logger.userInteraction('MAP', 'Fit all markers clicked', { markerCount: window.eventsMapMarkers.length });
    }
}

function toggleFullscreen() {
    const mapContainer = document.querySelector('.map-container');
    if (!mapContainer) return;
    
    logger.userInteraction('MAP', 'Fullscreen toggle requested');
    
    // Check if we're currently in fullscreen mode (including mobile pseudo-fullscreen)
    const isCurrentlyFullscreen = mapContainer.classList.contains('mobile-fullscreen') || 
                                 getFullscreenElement() !== null;
    
    if (isCurrentlyFullscreen) {
        exitFullscreen(mapContainer);
    } else {
        enterFullscreen(mapContainer);
    }
}

// Enhanced fullscreen detection with vendor prefixes
function getFullscreenElement() {
    return document.fullscreenElement || 
           document.webkitFullscreenElement || 
           document.mozFullScreenElement || 
           document.msFullscreenElement;
}

// Enhanced fullscreen API support detection
function isFullscreenSupported() {
    const doc = document.documentElement;
    return !!(doc.requestFullscreen || 
              doc.webkitRequestFullscreen || 
              doc.mozRequestFullScreen || 
              doc.msRequestFullscreen);
}

// Detect if we're on a mobile device (specifically iOS/mobile Safari)
function isMobileDevice() {
    return /iPhone|iPad|iPod|Android|Mobile|Opera Mini/i.test(navigator.userAgent) ||
           ('ontouchstart' in window) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
}

// Enhanced enter fullscreen with fallbacks
function enterFullscreen(element) {
    const isMobile = isMobileDevice();
    const fullscreenSupported = isFullscreenSupported();
    
    // For mobile devices or when fullscreen API isn't supported, use CSS-based fullscreen
    if (isMobile || !fullscreenSupported) {
        enterMobileFullscreen(element);
        return;
    }
    
    // Try standard fullscreen API with vendor prefixes
    const requestFullscreen = element.requestFullscreen || 
                             element.webkitRequestFullscreen || 
                             element.mozRequestFullScreen || 
                             element.msRequestFullscreen;
    
    if (requestFullscreen) {
        requestFullscreen.call(element).then(() => {
            logger.userInteraction('MAP', 'Native fullscreen mode enabled');
            setTimeout(() => {
                if (window.eventsMap) {
                    window.eventsMap.invalidateSize();
                }
            }, 100);
        }).catch(err => {
            logger.warn('MAP', 'Native fullscreen failed, falling back to mobile fullscreen', err);
            enterMobileFullscreen(element);
        });
    } else {
        // Fallback to mobile fullscreen
        enterMobileFullscreen(element);
    }
}

// Enhanced exit fullscreen with fallbacks
function exitFullscreen(element) {
    // First try to exit mobile fullscreen
    if (element.classList.contains('mobile-fullscreen')) {
        exitMobileFullscreen(element);
        return;
    }
    
    // Try standard fullscreen API with vendor prefixes
    const exitFullscreenMethod = document.exitFullscreen || 
                                 document.webkitExitFullscreen || 
                                 document.mozCancelFullScreen || 
                                 document.msExitFullscreen;
    
    if (exitFullscreenMethod && getFullscreenElement()) {
        exitFullscreenMethod.call(document).then(() => {
            logger.userInteraction('MAP', 'Native fullscreen mode disabled');
            setTimeout(() => {
                if (window.eventsMap) {
                    window.eventsMap.invalidateSize();
                }
            }, 100);
        }).catch(err => {
            logger.warn('MAP', 'Native fullscreen exit failed', err);
        });
    }
}

// Mobile-friendly fullscreen implementation
function enterMobileFullscreen(element) {
    // Add mobile fullscreen class
    element.classList.add('mobile-fullscreen');
    
    // Prevent body scrolling
    document.body.style.overflow = 'hidden';
    
    // Hide mobile browser UI by scrolling
    if (window.scrollTo) {
        window.scrollTo(0, 1);
        setTimeout(() => window.scrollTo(0, 0), 100);
    }
    
    // For iOS Safari, set viewport to prevent zooming
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
        viewport.setAttribute('data-original-content', viewport.content);
        viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    }
    
    logger.userInteraction('MAP', 'Mobile fullscreen mode enabled');
    
    // Invalidate map size after animation
    setTimeout(() => {
        if (window.eventsMap) {
            window.eventsMap.invalidateSize();
        }
    }, 300);
}

// Exit mobile fullscreen
function exitMobileFullscreen(element) {
    // Remove mobile fullscreen class
    element.classList.remove('mobile-fullscreen');
    
    // Restore body scrolling
    document.body.style.overflow = '';
    
    // Restore original viewport if it was modified
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && viewport.hasAttribute('data-original-content')) {
        viewport.content = viewport.getAttribute('data-original-content');
        viewport.removeAttribute('data-original-content');
    }
    
    logger.userInteraction('MAP', 'Mobile fullscreen mode disabled');
    
    // Invalidate map size after animation
    setTimeout(() => {
        if (window.eventsMap) {
            window.eventsMap.invalidateSize();
        }
    }, 300);
}

function showMyLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                if (window.eventsMap) {
                    // Remove existing location marker
                    if (window.myLocationMarker) {
                        window.eventsMap.removeLayer(window.myLocationMarker);
                    }
                    
                    // Add new location marker
                    const myLocationIcon = L.divIcon({
                        className: 'my-location-marker',
                        html: `
                            <div class="my-location-pin">
                                <div class="my-location-icon">📍</div>
                            </div>
                        `,
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    });
                    
                    window.myLocationMarker = L.marker([lat, lng], {
                        icon: myLocationIcon
                    }).addTo(window.eventsMap).bindPopup('📍 Your Location');
                    
                    // Center map on user location
                    window.eventsMap.setView([lat, lng], 14);
                    
                    logger.userInteraction('MAP', 'My location shown', { lat, lng });
                }
            },
            (error) => {
                console.warn('Location access denied or unavailable:', error);
                alert('Location access denied or unavailable. Please enable location services to use this feature.');
            }
        );
    } else {
        alert('Geolocation is not supported by this browser.');
    }
}

// Ensure app is initialized
document.addEventListener('DOMContentLoaded', () => {
    if (!window.chunkyApp) {
        logger.warn('SYSTEM', 'ChunkyApp not found, functions may not work properly');
    }
});
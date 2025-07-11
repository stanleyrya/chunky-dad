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
    if (mapContainer) {
        if (!document.fullscreenElement) {
            mapContainer.requestFullscreen().then(() => {
                // Invalidate size to fix map rendering in fullscreen
                setTimeout(() => {
                    if (window.eventsMap) {
                        window.eventsMap.invalidateSize();
                    }
                }, 100);
                logger.userInteraction('MAP', 'Fullscreen mode enabled');
            }).catch(err => {
                console.warn('Could not enable fullscreen mode:', err);
            });
        } else {
            document.exitFullscreen().then(() => {
                // Invalidate size to fix map rendering when exiting fullscreen
                setTimeout(() => {
                    if (window.eventsMap) {
                        window.eventsMap.invalidateSize();
                    }
                }, 100);
                logger.userInteraction('MAP', 'Fullscreen mode disabled');
            });
        }
    }
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
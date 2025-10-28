/**
 * LocationManager - Centralized location services for chunky.dad
 * 
 * Features:
 * - Permission state checking
 * - Location caching with expiry
 * - Private mode handling
 * - Flexible API for map and event features
 * - Error handling with user-friendly messages
 */

class LocationManager {
    constructor() {
        this.cacheKey = 'chunky_dad_location_cache';
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
        this.maxCacheAge = 30 * 60 * 1000; // 30 minutes max
        this.isPrivateMode = this.detectPrivateMode();
        
        // Initialize logger if available
        this.logger = window.logger || console;
        
        this.logger.info('LOCATION', 'LocationManager initialized', {
            isPrivateMode: this.isPrivateMode,
            cacheExpiry: this.cacheExpiry,
            maxCacheAge: this.maxCacheAge
        });
    }

    /**
     * Detect if browser is in private/incognito mode
     * This is a best-effort detection since browsers limit this info
     */
    detectPrivateMode() {
        try {
            // Test if we can write to storage
            const testKey = 'chunky_dad_private_test';
            sessionStorage.setItem(testKey, 'test');
            sessionStorage.removeItem(testKey);
            return false;
        } catch (e) {
            // If we can't write to storage, likely private mode
            return true;
        }
    }

    /**
     * Check if geolocation is supported
     */
    isGeolocationSupported() {
        return 'geolocation' in navigator;
    }

    /**
     * Check current permission state (if supported)
     */
    async checkPermissionState() {
        if (!this.isGeolocationSupported()) {
            return 'unsupported';
        }

        if (!navigator.permissions) {
            return 'unknown'; // Older browsers don't support permissions API
        }

        try {
            const result = await navigator.permissions.query({ name: 'geolocation' });
            return result.state; // 'granted', 'denied', or 'prompt'
        } catch (error) {
            this.logger.warn('LOCATION', 'Permission check failed', { error: error.message });
            return 'unknown';
        }
    }

    /**
     * Get cached location if available and not expired
     */
    getCachedLocation() {
        if (this.isPrivateMode) {
            this.logger.debug('LOCATION', 'Skipping cache in private mode');
            return null;
        }

        try {
            const cached = sessionStorage.getItem(this.cacheKey);
            if (!cached) return null;

            const { lat, lng, timestamp, accuracy } = JSON.parse(cached);
            const age = Date.now() - timestamp;

            if (age > this.maxCacheAge) {
                // Cache too old, remove it
                sessionStorage.removeItem(this.cacheKey);
                this.logger.debug('LOCATION', 'Cache expired and removed', { age });
                return null;
            }

            if (age > this.cacheExpiry) {
                // Cache is stale but not too old, return with warning
                this.logger.debug('LOCATION', 'Using stale cache', { age, accuracy });
                return { lat, lng, accuracy, stale: true };
            }

            this.logger.debug('LOCATION', 'Using fresh cache', { age, accuracy });
            return { lat, lng, accuracy, stale: false };
        } catch (error) {
            this.logger.warn('LOCATION', 'Cache read failed', { error: error.message });
            return null;
        }
    }

    /**
     * Cache location data
     */
    cacheLocation(lat, lng, accuracy = null) {
        if (this.isPrivateMode) {
            this.logger.debug('LOCATION', 'Skipping cache in private mode');
            return;
        }

        try {
            const locationData = {
                lat,
                lng,
                accuracy,
                timestamp: Date.now()
            };
            sessionStorage.setItem(this.cacheKey, JSON.stringify(locationData));
            this.logger.debug('LOCATION', 'Location cached', { lat, lng, accuracy });
        } catch (error) {
            this.logger.warn('LOCATION', 'Cache write failed', { error: error.message });
        }
    }

    /**
     * Get current location with caching and permission awareness
     * @param {Object} options - Options for getCurrentPosition
     * @param {boolean} forceRefresh - Force new location request even if cached
     * @returns {Promise<Object>} Location data with lat, lng, accuracy, source
     */
    async getCurrentLocation(options = {}, forceRefresh = false) {
        const defaultOptions = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000 // 5 minutes
        };

        const finalOptions = { ...defaultOptions, ...options };

        // Check if geolocation is supported
        if (!this.isGeolocationSupported()) {
            throw new Error('Geolocation is not supported by this browser');
        }

        // Check permission state
        const permissionState = await this.checkPermissionState();
        if (permissionState === 'denied') {
            throw new Error('Location access has been denied. Please enable location permissions in your browser settings.');
        }

        // Try cached location first (unless force refresh)
        if (!forceRefresh) {
            const cached = this.getCachedLocation();
            if (cached) {
                this.logger.info('LOCATION', 'Using cached location', { 
                    source: 'cache',
                    stale: cached.stale,
                    accuracy: cached.accuracy
                });
                return {
                    lat: cached.lat,
                    lng: cached.lng,
                    accuracy: cached.accuracy,
                    source: 'cache',
                    stale: cached.stale
                };
            }
        }

        // Request new location
        this.logger.info('LOCATION', 'Requesting new location', { 
            permissionState,
            forceRefresh,
            options: finalOptions
        });

        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    const accuracy = position.coords.accuracy;

                    // Cache the new location
                    this.cacheLocation(lat, lng, accuracy);

                    this.logger.info('LOCATION', 'Location obtained', { 
                        lat, 
                        lng, 
                        accuracy,
                        source: 'gps'
                    });

                    resolve({
                        lat,
                        lng,
                        accuracy,
                        source: 'gps',
                        stale: false
                    });
                },
                (error) => {
                    let errorMessage;
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage = 'Location access denied. Please enable location permissions to use this feature.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage = 'Location information is unavailable. Please check your device settings.';
                            break;
                        case error.TIMEOUT:
                            errorMessage = 'Location request timed out. Please try again.';
                            break;
                        default:
                            errorMessage = 'Unable to get your location. Please try again.';
                    }

                    this.logger.error('LOCATION', 'Location request failed', {
                        errorCode: error.code,
                        errorMessage: error.message,
                        userMessage: errorMessage
                    });

                    reject(new Error(errorMessage));
                },
                finalOptions
            );
        });
    }

    /**
     * Get location for map display (with fallback to cached)
     * @param {boolean} preferCached - Prefer cached location if available
     */
    async getLocationForMap(preferCached = true) {
        try {
            if (preferCached) {
                const cached = this.getCachedLocation();
                if (cached && !cached.stale) {
                    return await this.getCurrentLocation({}, false);
                }
            }
            return await this.getCurrentLocation({}, false);
        } catch (error) {
            // If fresh location fails, try cached as fallback
            const cached = this.getCachedLocation();
            if (cached) {
                this.logger.warn('LOCATION', 'Using stale cache as fallback', { 
                    error: error.message,
                    cachedAge: Date.now() - (cached.timestamp || 0)
                });
                return {
                    lat: cached.lat,
                    lng: cached.lng,
                    accuracy: cached.accuracy,
                    source: 'cache_fallback',
                    stale: true
                };
            }
            throw error;
        }
    }

    /**
     * Get location for event data (always try fresh first)
     * This will be used for future event sorting/filtering features
     */
    async getLocationForEvents() {
        try {
            return await this.getCurrentLocation({}, false);
        } catch (error) {
            // For event data, we might want to be more strict about stale data
            const cached = this.getCachedLocation();
            if (cached && !cached.stale) {
                this.logger.warn('LOCATION', 'Using fresh cache for events', { 
                    error: error.message 
                });
                return {
                    lat: cached.lat,
                    lng: cached.lng,
                    accuracy: cached.accuracy,
                    source: 'cache',
                    stale: false
                };
            }
            throw error;
        }
    }

    /**
     * Smart location request that minimizes iOS permission prompts
     * Only requests location if we don't have recent cached data
     */
    async getLocationSmart() {
        try {
            // First check if we have recent cached location
            const cached = this.getCachedLocation();
            if (cached && !cached.stale) {
                this.logger.debug('LOCATION', 'Using recent cached location (smart)', { 
                    age: Date.now() - cached.timestamp,
                    accuracy: cached.accuracy
                });
                return {
                    lat: cached.lat,
                    lng: cached.lng,
                    accuracy: cached.accuracy,
                    source: 'cache',
                    stale: false
                };
            }

            // Check permission state before requesting
            const permissionState = await this.checkPermissionState();
            if (permissionState === 'denied') {
                throw new Error('Location access has been denied. Please enable location permissions in your browser settings.');
            }

            // Only request if we have permission or it's the first time
            if (permissionState === 'granted' || permissionState === 'prompt') {
                this.logger.debug('LOCATION', 'Requesting location (smart)', { permissionState });
                return await this.getCurrentLocation({}, false);
            }

            // If permission is unknown, try cached as fallback
            if (cached) {
                this.logger.debug('LOCATION', 'Using stale cache as fallback (smart)', { 
                    age: Date.now() - cached.timestamp 
                });
                return {
                    lat: cached.lat,
                    lng: cached.lng,
                    accuracy: cached.accuracy,
                    source: 'cache_fallback',
                    stale: true
                };
            }

            throw new Error('Location not available');
        } catch (error) {
            this.logger.debug('LOCATION', 'Smart location request failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Clear cached location
     */
    clearCache() {
        try {
            sessionStorage.removeItem(this.cacheKey);
            this.logger.info('LOCATION', 'Location cache cleared');
        } catch (error) {
            this.logger.warn('LOCATION', 'Cache clear failed', { error: error.message });
        }
    }

    /**
     * Get location status for UI display
     */
    async getLocationStatus() {
        const permissionState = await this.checkPermissionState();
        const cached = this.getCachedLocation();
        
        return {
            supported: this.isGeolocationSupported(),
            permissionState,
            hasCachedLocation: !!cached,
            cacheAge: cached ? Date.now() - cached.timestamp : null,
            isPrivateMode: this.isPrivateMode
        };
    }

    /**
     * Check if user location is available for features (no popup)
     * Returns location if available, null if not
     */
    async getLocationForFeatures() {
        try {
            // Use smart location request to minimize prompts
            const location = await this.getLocationSmart();
            this.logger.debug('LOCATION', 'Location available for features', { 
                lat: location.lat, 
                lng: location.lng,
                source: location.source,
                stale: location.stale 
            });
            return location;
        } catch (error) {
            this.logger.debug('LOCATION', 'Location not available for features', { error: error.message });
            return null;
        }
    }

    /**
     * Calculate distance between two coordinates using Haversine formula
     * @param {number} lat1 - First latitude
     * @param {number} lng1 - First longitude  
     * @param {number} lat2 - Second latitude
     * @param {number} lng2 - Second longitude
     * @returns {number} Distance in miles
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 3959; // Earth's radius in miles
        const dLat = this.toRadians(lat2 - lat1);
        const dLng = this.toRadians(lng2 - lng1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return Math.round(R * c * 10) / 10; // Round to 1 decimal place
    }

    /**
     * Convert degrees to radians
     * @param {number} degrees - Degrees to convert
     * @returns {number} Radians
     */
    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Calculate distances from user location to events
     * @param {Array} events - Array of events with coordinates
     * @param {Object} userLocation - User location with lat/lng
     * @returns {Array} Events with distanceFromUser property added
     */
    calculateEventDistances(events, userLocation) {
        if (!userLocation || !events) return events;
        
        return events.map(event => {
            if (event.coordinates && event.coordinates.lat && event.coordinates.lng) {
                const distance = this.calculateDistance(
                    userLocation.lat, 
                    userLocation.lng,
                    event.coordinates.lat, 
                    event.coordinates.lng
                );
                return { ...event, distanceFromUser: distance };
            }
            return event;
        });
    }

    /**
     * Initialize location features - check availability and return location if available
     * @returns {Object|null} Location data if available, null otherwise
     */
    async initializeLocationFeatures() {
        try {
            this.logger.debug('LOCATION', 'Initializing location features');
            
            const location = await this.getLocationForFeatures();
            
            if (location) {
                this.logger.info('LOCATION', 'Location features initialized successfully', { 
                    lat: location.lat, 
                    lng: location.lng,
                    source: location.source,
                    stale: location.stale
                });
            } else {
                this.logger.debug('LOCATION', 'Location features not available');
            }
            
            return location;
        } catch (error) {
            this.logger.debug('LOCATION', 'Location features initialization failed', { error: error.message });
            return null;
        }
    }

    /**
     * Update location status and store in global variable for UI access
     * This handles the complete location status flow including UI updates
     * @param {Function} updateButtonStatus - Callback to update UI button status
     * @returns {Object|null} Location data if available, null otherwise
     */
    async updateLocationStatus(updateButtonStatus) {
        try {
            const status = await this.getLocationStatus();
            
            if (status.supported && status.permissionState === 'granted' && status.hasCachedLocation) {
                updateButtonStatus('success', 'cached');
                
                // Store cached location for features
                const cached = this.getCachedLocation();
                if (cached) {
                    window.userLocation = cached;
                    this.logger.debug('LOCATION', 'Cached location stored for features', { 
                        lat: cached.lat, 
                        lng: cached.lng,
                        stale: cached.stale 
                    });
                    return cached;
                }
            } else if (status.supported && status.permissionState === 'granted' && !status.hasCachedLocation) {
                // We have permission but no cached location - request silently
                updateButtonStatus('loading', 'checking');
                
                try {
                    const location = await this.getLocationForFeatures();
                    if (location) {
                        window.userLocation = location;
                        updateButtonStatus('success', 'fresh');
                        
                        this.logger.debug('LOCATION', 'Fresh location obtained silently', { 
                            lat: location.lat, 
                            lng: location.lng,
                            source: location.source 
                        });
                        return location;
                    } else {
                        updateButtonStatus('default');
                        return null;
                    }
                } catch (error) {
                    // Silent fail - user can still use manual button
                    updateButtonStatus('default');
                    this.logger.debug('LOCATION', 'Silent location request failed', { error: error.message });
                    return null;
                }
            } else if (status.supported && status.permissionState === 'denied') {
                updateButtonStatus('error');
                return null;
            } else {
                updateButtonStatus('default');
                return null;
            }
        } catch (error) {
            this.logger.debug('LOCATION', 'Location status check failed', { error: error.message });
            updateButtonStatus('default');
            return null;
        }
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.LocationManager = LocationManager;
}
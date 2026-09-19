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
        // City-scale features (nearest-city sort, the map dot) don't need a
        // fresh GPS fix — a days-old one still picks the right city. The
        // cache lives in localStorage and lasts long enough that repeat
        // visits reuse it instead of calling getCurrentPosition again, which
        // is what made Safari re-ask for location approval on every visit.
        // NOTE these bound the cached COORDINATES, not the permission. The
        // browser owns the permission grant and keeps it until the user
        // revokes it; nothing here can lengthen or shorten that. All this
        // decides is how long we reuse a stored fix instead of calling
        // getCurrentPosition again.
        //
        // Everything the fix is used for is city-scale — sorting cities by
        // distance, the dot on the map, the "N mi" pill — so it does not need
        // to be recent, it needs to be in the right city. The only real risk
        // is travel, and a stale value is served ONLY as a fallback when a
        // live fix fails (getLocationForMap), so the cost of a longer window
        // is small and the benefit is not re-prompting on every visit.
        // Owner 2026-09-19: the site kept him "in Iceland" for weeks after
        // flying to Sitges — every path handed back ANY cached fix, up to 30
        // days old, without asking the browser again. Now a fix is "fresh"
        // for an hour; older than that a real request is made (silently when
        // the browser already granted, always on the button), and the old
        // fix is only a FALLBACK when that request fails — marked stale so
        // the UI can say so. Whether a prompt appears is the browser's call
        // (Safari: Settings → Safari → Location → chunky.dad → Allow).
        this.cacheExpiry = 60 * 60 * 1000; // 1 hour: served as "fresh"
        this.maxCacheAge = 30 * 24 * 60 * 60 * 1000; // 30 days: kept as a fallback only
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
            // localStorage, not sessionStorage: the whole point of the cache
            // is surviving into the NEXT visit so we don't re-prompt
            const cached = localStorage.getItem(this.cacheKey);
            if (!cached) return null;

            const { lat, lng, timestamp, accuracy } = JSON.parse(cached);
            const age = Date.now() - timestamp;

            if (age > this.maxCacheAge) {
                // Cache too old, remove it
                localStorage.removeItem(this.cacheKey);
                this.logger.debug('LOCATION', 'Cache expired and removed', { age });
                return null;
            }

            if (age > this.cacheExpiry) {
                // Cache is stale but not too old, return with warning
                this.logger.debug('LOCATION', 'Using stale cache', { age, accuracy });
                return { lat, lng, accuracy, stale: true, ageMs: age, timestamp };
            }

            this.logger.debug('LOCATION', 'Using fresh cache', { age, accuracy });
            return { lat, lng, accuracy, stale: false, ageMs: age, timestamp };
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
            localStorage.setItem(this.cacheKey, JSON.stringify(locationData));
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

        // A forced refresh never accepts the browser's own cached position.
        const finalOptions = { ...defaultOptions, ...(forceRefresh ? { maximumAge: 0 } : {}), ...options };

        // Check if geolocation is supported
        if (!this.isGeolocationSupported()) {
            throw new Error('Geolocation is not supported by this browser');
        }

        // NOTE: no awaited permission pre-check here. Awaiting
        // navigator.permissions.query() before getCurrentPosition detaches
        // the request from the tap's user-gesture context — iOS Safari then
        // suppresses the permission prompt and the request hangs forever
        // (the location button "hasn't worked in a while").
        // getCurrentPosition reports denial through its own error callback.
        const permissionState = 'unchecked';

        // Try cached location first (unless force refresh)
        // A FRESH cached fix answers without asking the browser; a stale one
        // never does (it is the fallback below, when the request fails).
        if (!forceRefresh) {
            const cached = this.getCachedLocation();
            if (cached && !cached.stale) {
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

                    // The last known fix, marked as such: better than nothing
                    // for city-scale features, and the UI can say it is old.
                    const fallback = this.getCachedLocation();
                    if (fallback) {
                        this.logger.warn('LOCATION', 'Using last known location as fallback', { error: errorMessage, cachedAgeMs: fallback.ageMs });
                        resolve({ lat: fallback.lat, lng: fallback.lng, accuracy: fallback.accuracy, source: 'cache_fallback', stale: true, ageMs: fallback.ageMs, error: errorMessage });
                        return;
                    }
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
    // preferCached = false is the map's location BUTTON: a press always asks
    // the browser for a new fix (the fallback lives in getCurrentLocation).
    async getLocationForMap(preferCached = true) {
        return this.getCurrentLocation({}, !preferCached);
    }

    async getLocationForEvents() {
        return this.getCurrentLocation({}, false);
    }

    /**
     * Clear cached location
     */
    clearCache() {
        try {
            localStorage.removeItem(this.cacheKey);
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
    // The silent path (page load): a fresh fix is used as is; a stale or
    // missing one is refreshed only when the browser already granted (no
    // prompt on load); with the grant still unanswered a stale fix is
    // served marked stale — the button is where the browser gets asked.
    async getLocationForFeatures() {
        try {
            const status = await this.getLocationStatus();
            const cached = this.getCachedLocation();
            if (cached && !cached.stale) {
                this.logger.debug('LOCATION', 'Using fresh cached location for features', { lat: cached.lat, lng: cached.lng });
                return { ...cached, source: 'cache' };
            }
            if (status.supported && status.permissionState === 'granted') {
                this.logger.debug('LOCATION', 'Refreshing location for features (granted, cache stale or missing)');
                return await this.getCurrentLocation({}, true);
            }
            if (cached) {
                this.logger.debug('LOCATION', 'Using stale cached location for features (browser not yet granted)', { lat: cached.lat, lng: cached.lng, ageMs: cached.ageMs });
                return { ...cached, source: 'cache' };
            }

            // No permission or not supported
            this.logger.debug('LOCATION', 'Location not available for features', { 
                supported: status.supported, 
                permissionState: status.permissionState 
            });
            return null;
        } catch (error) {
            this.logger.debug('LOCATION', 'Location request for features failed', { error: error.message });
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
            const freshCached = status.supported && status.permissionState === 'granted' ? this.getCachedLocation() : null;
            if (freshCached && !freshCached.stale) {
                updateButtonStatus('success', 'cached');
                window.userLocation = freshCached;
                this.logger.debug('LOCATION', 'Fresh cached location stored for features', { lat: freshCached.lat, lng: freshCached.lng });
                return freshCached;
            } else if (status.supported && status.permissionState === 'granted') {
                // Granted, and the cache is stale or missing: refresh silently
                // (getLocationForFeatures falls back to the stale fix if the
                // request fails).
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
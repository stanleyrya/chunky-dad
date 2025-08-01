// ============================================================================
// CITY UTILITIES - SHARED CITY MAPPING AND EXTRACTION LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains SHARED utility functions only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ City name mappings and normalization
// ✅ Address parsing and city extraction
// ✅ Location text processing utilities
// ✅ Reusable functions for all parsers
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Parser-specific logic
// ❌ HTTP requests or API calls
// ❌ Environment-specific code
// ❌ Calendar or event processing
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class CityUtils {
    constructor() {
        // Enhanced city mappings for consistent parsing across all parsers
        this.cityMappings = {
            'new york|nyc|manhattan|brooklyn|queens|bronx': 'nyc',
            'los angeles|hollywood|west hollywood|weho|dtla|downtown los angeles': 'la',
            'san francisco|sf|castro': 'sf',
            'chicago|chi': 'chicago',
            'atlanta|atl': 'atlanta',
            'miami|south beach|miami beach': 'miami',
            'seattle': 'seattle',
            'portland': 'portland',
            'denver': 'denver',
            'las vegas|vegas': 'vegas',
            'boston': 'boston',
            'philadelphia|philly': 'philadelphia',
            'austin': 'austin',
            'dallas': 'dallas',
            'houston': 'houston',
            'phoenix': 'phoenix',
            'long beach': 'la' // Long Beach is part of LA area for bear events
        };

        // City normalizations for consistent naming
        this.normalizations = {
            'new york': 'nyc',
            'new york city': 'nyc',
            'manhattan': 'nyc',
            'los angeles': 'la',
            'san francisco': 'sf',
            'las vegas': 'vegas'
        };
    }

    // Extract city from address string
    extractCityFromAddress(address) {
        if (!address || typeof address !== 'string') return null;
        
        const lowerAddress = address.toLowerCase();
        
        // Special case for "LA" - only match if it's standalone or followed by comma/space
        if (/\bla\b[,\s]|^la[,\s]|[,\s]la$/i.test(lowerAddress)) {
            return 'la';
        }
        
        // First try exact matches in address - use word boundaries for precision
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                // Use word boundaries to avoid substring matches (e.g., "la" in "Atlanta")
                const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (regex.test(lowerAddress)) {
                    return city;
                }
            }
        }
        
        // Try to extract city from standard address format: "City, State ZIP"
        const cityStateMatch = address.match(/([^,]+),\s*([A-Z]{2})\s*\d{5}/i);
        if (cityStateMatch) {
            const cityName = cityStateMatch[1].trim().toLowerCase();
            const stateName = cityStateMatch[2].trim().toUpperCase();
            
            // Check if the extracted city matches our mappings
            for (const [patterns, city] of Object.entries(this.cityMappings)) {
                const patternList = patterns.split('|');
                for (const pattern of patternList) {
                    // Use word boundaries to avoid substring matches
                    const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                    if (regex.test(cityName)) {
                        return city;
                    }
                }
            }
            
            // State-specific mappings for cities not in main list
            const stateSpecificMappings = {
                'GA': { 'atlanta': 'atlanta' },
                'NV': { 'las vegas': 'vegas' },
                'CO': { 'denver': 'denver' },
                'CA': { 'los angeles': 'la', 'long beach': 'la' }
            };
            
            if (stateSpecificMappings[stateName] && stateSpecificMappings[stateName][cityName]) {
                return stateSpecificMappings[stateName][cityName];
            }
            
            // Return normalized city name if not in mappings
            return this.normalizeCityName(cityName);
        }
        
        return null;
    }

    // Extract city from text content (titles, descriptions, etc.)
    extractCityFromText(text) {
        if (!text || typeof text !== 'string') return null;
        
        const lowerText = text.toLowerCase();
        
        // Special case for "LA" - only match if it's standalone
        if (/\bla\b/i.test(lowerText)) {
            return 'la';
        }
        
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                // Use word boundaries for precise matching
                const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (regex.test(lowerText)) {
                    return city;
                }
            }
        }
        
        return null;
    }

    // Normalize city names to consistent format
    normalizeCityName(cityName) {
        if (!cityName || typeof cityName !== 'string') return null;
        
        const lower = cityName.toLowerCase().trim();
        return this.normalizations[lower] || lower;
    }

    // Extract city from event data using multiple methods
    extractCityFromEvent(eventData, url = '') {
        let city = null;
        
        // Method 1: Extract from address if available
        if (eventData.venue?.address) {
            const address = eventData.venue.address.localized_address_display || 
                           eventData.venue.address.address_1 || 
                           eventData.venue.address;
            if (address) {
                city = this.extractCityFromAddress(address);
                if (city) return city;
            }
        }
        
        // Method 2: Extract from venue name and title
        const searchText = `${eventData.name || eventData.title || ''} ${eventData.venue?.name || ''} ${eventData.description || ''}`;
        city = this.extractCityFromText(searchText);
        if (city) return city;
        
        // Method 3: Extract from URL
        if (url) {
            city = this.extractCityFromText(url);
            if (city) return city;
        }
        
        return null;
    }

    // Get all supported cities
    getSupportedCities() {
        const cities = new Set();
        
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            cities.add(city);
        }
        
        return Array.from(cities).sort();
    }

    // Check if a city is supported
    isSupportedCity(city) {
        if (!city) return false;
        
        const normalizedCity = this.normalizeCityName(city);
        return this.getSupportedCities().includes(normalizedCity);
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CityUtils };
} else if (typeof window !== 'undefined') {
    window.CityUtils = CityUtils;
} else {
    // Scriptable environment
    this.CityUtils = CityUtils;
}
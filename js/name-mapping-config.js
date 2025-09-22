/**
 * Centralized Name Mapping Configuration
 * Used by both dynamic-calendar-loader.js and GitHub Actions
 * 
 * This file contains patterns and mappings for generating short names
 * and handling name transformations consistently across the application.
 */

const NAME_MAPPING_CONFIG = {
    // Stop words to remove when generating short names
    stopWords: [
        'the', 'and', 'or', 'at', 'in', 'on', 'with', 'for', 'of', 'to', 'a', 'an',
        'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
        'above', 'below', 'between', 'among', 'under', 'over', 'around', 'near'
    ],

    // Hyphenation patterns for better word wrapping
    hyphenationPatterns: [
        // Bear community specific terms
        { pattern: /^(Rock)(strap)$/i, replacement: '$1-$2' },
        { pattern: /^(Under)(wear)$/i, replacement: '$1-$2' },
        { pattern: /^(Leather)(daddy|bear|night)$/i, replacement: '$1-$2' },
        { pattern: /^(Bear)(night|party|weekend)$/i, replacement: '$1-$2' },
        { pattern: /^(Happy)(hour)$/i, replacement: '$1-$2' },
        { pattern: /^(After)(party|hours)$/i, replacement: '$1-$2' },
        { pattern: /^(Pre)(game|party)$/i, replacement: '$1-$2' },
        { pattern: /^(Post)(game|party|work)$/i, replacement: '$1-$2' },
        { pattern: /^(Mid)(week|night)$/i, replacement: '$1-$2' },
        { pattern: /^(Week)(end|night)$/i, replacement: '$1-$2' },
        
        // General compound word patterns
        { pattern: /^(.{4,6})(night|party|fest|event)$/i, replacement: '$1-$2' },
        { pattern: /^(night|party|bear)(.{4,})$/i, replacement: '$1-$2' },
    ],

    // Specific name mappings for common events
    // These take precedence over pattern-based generation
    specificMappings: {
        // MEGAWOOF variations
        'MEGAWOOF': 'MEGA-WOOF',
        'MEGAWOOF AMERICA': 'MEGA-WOOF',
        'MEGAWOOF AMERICA - LAS VEGAS': 'MEGA-WOOF',
        'MEGAWOOF - 10 YEAR US ANNIVERSARY': 'MEGA-WOOF',
        
        // Bearracuda variations
        'BEARRACUDA': 'BEAR-RACUDA',
        'BEARRACUDA ATLANTA': 'BEAR-RACUDA',
        'BEARRACUDA SF': 'BEAR-RACUDA',
        'BEARRACUDA PRESENTS': 'BEAR-RACUDA',
        
        // Other common events
        'BEARS NIGHT OUT': 'BEARS NIGHT OUT',
        'BEAR NIGHT': 'BEAR NIGHT',
        'LEATHER DADDY NIGHT': 'LEATHER-DADDY NIGHT',
        'HAPPY HOUR': 'HAPPY-HOUR',
        'AFTER PARTY': 'AFTER-PARTY',
        'PRE GAME': 'PRE-GAME',
        'POST GAME': 'POST-GAME',
        'MID WEEK': 'MID-WEEK',
        'WEEKEND NIGHT': 'WEEKEND-NIGHT',
    },

    // Venue name mappings
    venueMappings: {
        'Dust Las Vegas': 'Dust',
        'Falcon North': 'Falcon',
        'Trade Denver': 'Trade',
        'The Eagle NYC': 'Eagle',
        'Rockbar NYC': 'Rockbar',
        'The Urban Bear': 'Urban Bear',
        'Northalsted': 'Northalsted',
        'Animal NYC': 'Animal',
    }
};

/**
 * Generate a short name from bar name or event name
 * @param {string} barName - The bar/venue name
 * @param {string} eventName - The event name
 * @returns {string} - The generated short name
 */
function generateShortName(barName, eventName) {
    // Prefer event name if available, otherwise use bar name
    const sourceName = eventName || barName;
    if (!sourceName) return '';
    
    // Check for specific mappings first
    const upperSourceName = sourceName.toUpperCase();
    if (NAME_MAPPING_CONFIG.specificMappings[upperSourceName]) {
        return NAME_MAPPING_CONFIG.specificMappings[upperSourceName];
    }
    
    // Remove common words while preserving original casing
    const words = sourceName.split(' ');
    const filteredWords = words.filter(word => 
        !NAME_MAPPING_CONFIG.stopWords.includes(word.toLowerCase())
    );
    
    // If we filtered out all words (e.g., "The"), use the original
    if (filteredWords.length === 0) {
        return sourceName;
    }
    
    let result = filteredWords.join(' ');
    
    // For single long words, add intelligent hyphenation points for better breaking
    if (filteredWords.length === 1 && filteredWords[0].length > 8) {
        result = addIntelligentHyphens(filteredWords[0]);
    }
    
    return result;
}

/**
 * Add intelligent hyphenation points to long single words
 * @param {string} word - The word to hyphenate
 * @returns {string} - The hyphenated word
 */
function addIntelligentHyphens(word) {
    if (!word || word.length <= 8) return word;
    
    // Try each pattern
    for (const { pattern, replacement } of NAME_MAPPING_CONFIG.hyphenationPatterns) {
        if (pattern.test(word)) {
            return word.replace(pattern, replacement);
        }
    }
    
    // Fallback: add hyphen after 4-6 characters if no pattern matches
    if (word.length > 8) {
        const breakPoint = Math.min(6, Math.floor(word.length / 2));
        return word.slice(0, breakPoint) + '-' + word.slice(breakPoint);
    }
    
    return word;
}

/**
 * Get venue short name from venue mappings
 * @param {string} venueName - The full venue name
 * @returns {string} - The short venue name
 */
function getVenueShortName(venueName) {
    if (!venueName) return '';
    
    // Check for specific venue mappings
    if (NAME_MAPPING_CONFIG.venueMappings[venueName]) {
        return NAME_MAPPING_CONFIG.venueMappings[venueName];
    }
    
    // Fallback to general short name generation
    return generateShortName(venueName, '');
}

// Export for Node.js (CommonJS)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        NAME_MAPPING_CONFIG,
        generateShortName,
        addIntelligentHyphens,
        getVenueShortName
    };
}

// Export for browser (ES6 modules)
if (typeof window !== 'undefined') {
    window.NameMappingConfig = {
        NAME_MAPPING_CONFIG,
        generateShortName,
        addIntelligentHyphens,
        getVenueShortName
    };
}
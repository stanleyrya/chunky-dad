/**
 * Shared filename generation utilities
 * Used by both download-images.js and dynamic-calendar-loader.js
 */

/**
 * Generate a clean filename from a URL
 * Handles Eventbrite URLs specially with nested URL decoding
 * @param {string} url - The image URL
 * @returns {string} - The generated filename
 */
function generateFilenameFromUrl(url) {
    try {
        // Handle Eventbrite URLs specially - they have nested URL encoding
        if (url.includes('evbuc.com') && (url.includes('images/') || url.includes('images%2F'))) {
            // Extract the nested URL from the pathname
            const parsedUrl = new URL(url);
            const nestedUrl = decodeURIComponent(parsedUrl.pathname.substring(1)); // Remove leading slash
            
            // Parse the nested URL to get the actual image path
            const nestedParsedUrl = new URL(nestedUrl);
            const imageMatch = nestedParsedUrl.pathname.match(/images\/(\d+)\/(\d+)\/(\d+)\/([^?]+)/);
            
            if (imageMatch) {
                const [, id1, id2, id3, filename] = imageMatch;
                const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '.jpg';
                const basename = `evb-${id1}-${id2}-${id3}-${filename.replace(ext, '')}`;
                
                // Sanitize filename
                const sanitized = basename
                    .replace(/[^a-zA-Z0-9._-]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
                
                return sanitized + ext;
            }
        }
        
        // Handle regular URLs
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;
        const ext = pathname.includes('.') ? pathname.substring(pathname.lastIndexOf('.')) : '.jpg';
        let basename = pathname.substring(pathname.lastIndexOf('/') + 1).replace(ext, '') || 'image';
        
        // Sanitize filename - be more conservative with special characters
        const sanitized = basename
            .replace(/[^a-zA-Z0-9._-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        
        return sanitized + ext;
    } catch (error) {
        // Fallback to hash-based filename
        const hash = simpleHash(url);
        return `image-${hash}.jpg`;
    }
}

/**
 * Clean and validate a URL before processing
 * @param {string} imageUrl - The raw image URL
 * @returns {string} - The cleaned URL
 */
function cleanImageUrl(imageUrl) {
    if (!imageUrl || !imageUrl.startsWith('http')) {
        return imageUrl;
    }
    
    let cleanUrl = imageUrl;
    
    // Remove any trailing characters that aren't part of the URL
    // Stop at field separators like \n followed by field names
    cleanUrl = cleanUrl.replace(/\\n[a-zA-Z][a-zA-Z0-9]*:.*$/, '');
    cleanUrl = cleanUrl.replace(/[^\w\-._~:/?#[\]@!$&'()*+,;=%]+$/, '');
    
    // Additional cleanup: remove any remaining \n characters and fix escaped commas
    cleanUrl = cleanUrl.replace(/\\n/g, '');
    cleanUrl = cleanUrl.replace(/\\,/g, ',');
    
    // Fix specific issue where 'fac' gets appended to URLs (from 'facebook')
    cleanUrl = cleanUrl.replace(/\.jpgfac$/, '.jpg');
    
    // Validate the cleaned URL
    if (!cleanUrl.startsWith('http') || !cleanUrl.includes('.')) {
        return imageUrl; // Return original if cleaning failed
    }
    
    return cleanUrl;
}

/**
 * Generate a filename for favicon URLs with domain-based naming
 * @param {string} faviconUrl - The favicon URL
 * @returns {string} - The generated filename
 */
function generateFaviconFilename(faviconUrl) {
    try {
        const parsedUrl = new URL(faviconUrl);
        
        // For Google favicon service, extract the target domain from query parameter
        let domain;
        if (parsedUrl.hostname === 'www.google.com' && parsedUrl.pathname === '/s2/favicons') {
            const domainParam = parsedUrl.searchParams.get('domain');
            if (domainParam) {
                domain = domainParam;
            } else {
                // Fallback to hostname if no domain param
                domain = parsedUrl.hostname;
            }
        } else {
            // For other favicon services, use hostname
            domain = parsedUrl.hostname;
        }
        
        // Clean domain name for filename
        const cleanDomain = domain
            .replace(/^www\./, '') // Remove www prefix
            .replace(/[^a-zA-Z0-9.-]/g, '-') // Replace invalid chars with dashes
            .replace(/-+/g, '-') // Collapse multiple dashes
            .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
        
        // Determine file extension based on URL path or default to .ico
        let ext = '.ico';
        if (faviconUrl.includes('.png')) {
            ext = '.png';
        } else if (faviconUrl.includes('.jpg') || faviconUrl.includes('.jpeg')) {
            ext = '.jpg';
        } else if (faviconUrl.includes('.svg')) {
            ext = '.svg';
        }
        
        return `favicon-${cleanDomain}${ext}`;
    } catch (error) {
        // Fallback to hash-based filename
        const hash = simpleHash(faviconUrl);
        return `favicon-${hash}.ico`;
    }
}

/**
 * Convert an image URL to a local path
 * @param {string} imageUrl - The image URL
 * @param {string} basePath - The base path (e.g., 'img/events')
 * @returns {string} - The local file path
 */
function convertImageUrlToLocalPath(imageUrl, basePath = 'img/events') {
    if (!imageUrl || !imageUrl.startsWith('http')) {
        return imageUrl;
    }
    
    try {
        const cleanUrl = cleanImageUrl(imageUrl);
        const filename = generateFilenameFromUrl(cleanUrl);
        return `${basePath}/${filename}`;
    } catch (error) {
        return imageUrl; // Return original URL as fallback
    }
}

/**
 * Convert a favicon URL to a local path
 * @param {string} faviconUrl - The favicon URL
 * @param {string} basePath - The base path (e.g., 'img/favicons')
 * @returns {string} - The local file path
 */
function convertFaviconUrlToLocalPath(faviconUrl, basePath = 'img/favicons') {
    if (!faviconUrl || !faviconUrl.startsWith('http')) {
        return faviconUrl;
    }
    
    try {
        const filename = generateFaviconFilename(faviconUrl);
        return `${basePath}/${filename}`;
    } catch (error) {
        return faviconUrl; // Return original URL as fallback
    }
}

/**
 * Simple hash function for fallback filenames
 * @param {string} str - The string to hash
 * @returns {string} - The hash as a hex string
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8);
}

// ============================================================================
// NAME MAPPING UTILITIES - Centralized name processing for events and venues
// ============================================================================

/**
 * Name mapping configuration for consistent name processing
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
        generateFilenameFromUrl,
        generateFaviconFilename,
        cleanImageUrl,
        convertImageUrlToLocalPath,
        convertFaviconUrlToLocalPath,
        simpleHash,
        // Name mapping functions
        generateShortName,
        addIntelligentHyphens,
        getVenueShortName,
        NAME_MAPPING_CONFIG
    };
}

// Export for browser (ES6 modules)
if (typeof window !== 'undefined') {
    window.FilenameUtils = {
        generateFilenameFromUrl,
        generateFaviconFilename,
        cleanImageUrl,
        convertImageUrlToLocalPath,
        convertFaviconUrlToLocalPath,
        simpleHash,
        // Name mapping functions
        generateShortName,
        addIntelligentHyphens,
        getVenueShortName,
        NAME_MAPPING_CONFIG
    };
}
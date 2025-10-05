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
            let ext = '.jpg'; // Default extension
            if (filename.includes('.')) {
                const potentialExt = filename.substring(filename.lastIndexOf('.'));
                // Only use the extension if it looks like a valid image extension
                if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'].includes(potentialExt.toLowerCase())) {
                    ext = potentialExt;
                }
            }
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
    let ext = '.jpg'; // Default extension
    if (pathname.includes('.')) {
        const potentialExt = pathname.substring(pathname.lastIndexOf('.'));
        // Only use the extension if it looks like a valid image extension
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'].includes(potentialExt.toLowerCase())) {
            ext = potentialExt;
        }
    }
    let basename = pathname.substring(pathname.lastIndexOf('/') + 1).replace(ext, '') || 'image';
    
    // Sanitize filename - be more conservative with special characters
    const sanitized = basename
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    
    return sanitized + ext;
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
    const parsedUrl = new URL(faviconUrl);
    
    // For Google favicon service, extract the target domain from query parameter
    let domain;
    if (parsedUrl.hostname === 'www.google.com' && parsedUrl.pathname === '/s2/favicons') {
        domain = parsedUrl.searchParams.get('domain') || parsedUrl.hostname;
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
    
    // Add size suffix for px-sized favicons (prefer 64px for map markers)
    const sizeSuffix = '-64px';
    return `favicon-${cleanDomain}${sizeSuffix}${ext}`;
}

/**
 * Generate a slug from a string (event name, etc.)
 * @param {string} text - The text to slugify
 * @returns {string} - The slugified text
 */
function slugify(text) {
    if (!text) return 'untitled';
    
    return text
        .toString()
        .toLowerCase()
        .trim()
        // Replace spaces and special chars with hyphens
        .replace(/[\s_]+/g, '-')
        .replace(/[^\w-]+/g, '')
        // Collapse multiple hyphens
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        // Limit length
        .substring(0, 50);
}

/**
 * Generate an event-aware filename for better identification
 * @param {string} imageUrl - The image URL
 * @param {Object} eventInfo - Event information (name, date, recurring)
 * @returns {string} - The generated filename
 */
function generateEventFilename(imageUrl, eventInfo) {
    const cleanUrl = cleanImageUrl(imageUrl);
    const baseFilename = generateFilenameFromUrl(cleanUrl);
    
    // Ensure we always have a proper file extension
    let ext = '.jpg'; // Default extension
    if (baseFilename.includes('.')) {
        const lastDot = baseFilename.lastIndexOf('.');
        const potentialExt = baseFilename.substring(lastDot);
        // Only use the extension if it looks like a valid image extension
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'].includes(potentialExt.toLowerCase())) {
            ext = potentialExt;
        }
    }
    
    // Build filename parts
    const parts = [];
    
    // Add date for one-time events (YYYY-MM-DD format)
    if (eventInfo.startDate && !eventInfo.recurring) {
        const date = eventInfo.startDate instanceof Date ? 
            eventInfo.startDate : new Date(eventInfo.startDate);
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        parts.push(dateStr);
    }
    
    // Add event name slug
    parts.push(slugify(eventInfo.name));
    
    // Add original filename hash for uniqueness
    const urlHash = simpleHash(cleanUrl).substring(0, 8);
    parts.push(urlHash);
    
    return parts.join('_') + ext;
}

/**
 * Convert an image URL to a local path with event awareness
 * @param {string} imageUrl - The image URL
 * @param {Object} eventInfo - Event information (name, date, recurring) - REQUIRED
 * @param {string} basePath - The base path (e.g., 'img/events')
 * @returns {string} - The local file path
 */
function convertImageUrlToLocalPath(imageUrl, eventInfo, basePath = 'img/events') {
    const subdirectory = eventInfo.recurring ? 'recurring' : 'one-time';
    const filename = generateEventFilename(imageUrl, eventInfo);
    
    // For one-time events, organize by year/month folders
    if (!eventInfo.recurring && eventInfo.startDate) {
        const date = eventInfo.startDate instanceof Date ? 
            eventInfo.startDate : new Date(eventInfo.startDate);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0'); // MM format
        return `${basePath}/${subdirectory}/${year}/${month}/${filename}`;
    }
    
    return `${basePath}/${subdirectory}/${filename}`;
}

/**
 * Convert a favicon URL to a local path
 * @param {string} faviconUrl - The favicon URL
 * @param {string} basePath - The base path (e.g., 'img/favicons')
 * @returns {string} - The local file path
 */
function convertFaviconUrlToLocalPath(faviconUrl, basePath = 'img/favicons') {
    const filename = generateFaviconFilename(faviconUrl);
    return `${basePath}/${filename}`;
}

/**
 * Convert a website URL to a local favicon path, handling Linktree URLs specially
 * @param {string} websiteUrl - The website URL
 * @param {string} basePath - The base path (e.g., 'img/favicons')
 * @returns {string} - The local file path
 */
function convertWebsiteUrlToFaviconPath(websiteUrl, basePath = 'img/favicons') {
    const parsedUrl = new URL(websiteUrl);
    
    // Check if it's a Linktree URL
    if (parsedUrl.hostname === 'linktr.ee' || parsedUrl.hostname === 'www.linktr.ee') {
        // Generate Linktree-specific filename
        const pathname = parsedUrl.pathname.substring(1); // Remove leading slash
        const cleanPath = pathname
            .replace(/[^a-zA-Z0-9._-]/g, '-') // Replace invalid chars with dashes
            .replace(/-+/g, '-') // Collapse multiple dashes
            .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
        
        const filename = `favicon-linktr.ee-${cleanPath}-64px.png`;
        return `${basePath}/${filename}`;
    } else {
        // Use regular favicon logic for other domains (prefer 64px for higher quality)
        const hostname = parsedUrl.hostname;
        const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
        return convertFaviconUrlToLocalPath(googleFaviconUrl, basePath);
    }
}


/**
 * Simple hash function for filename uniqueness
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


// Export for Node.js (CommonJS)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generateFilenameFromUrl,
        generateFaviconFilename,
        generateEventFilename,
        cleanImageUrl,
        convertImageUrlToLocalPath,
        convertFaviconUrlToLocalPath,
        convertWebsiteUrlToFaviconPath,
        slugify,
        simpleHash
    };
}

// Export for browser (ES6 modules)
if (typeof window !== 'undefined') {
    window.FilenameUtils = {
        generateFilenameFromUrl,
        generateFaviconFilename,
        generateEventFilename,
        cleanImageUrl,
        convertImageUrlToLocalPath,
        convertFaviconUrlToLocalPath,
        convertWebsiteUrlToFaviconPath,
        slugify,
        simpleHash
    };
}
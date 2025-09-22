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
 * Convert external favicon URL to local path for cached data
 * @param {string} faviconUrl - The favicon URL
 * @returns {string} - The local file path
 */
function convertFaviconUrlToLocal(faviconUrl) {
    return convertFaviconUrlToLocalPath(faviconUrl, 'img/favicons');
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


// Export for Node.js (CommonJS)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generateFilenameFromUrl,
        generateFaviconFilename,
        cleanImageUrl,
        convertImageUrlToLocalPath,
        convertFaviconUrlToLocalPath,
        convertFaviconUrlToLocal,
        simpleHash
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
        convertFaviconUrlToLocal,
        simpleHash
    };
}
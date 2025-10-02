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
 * Convert a website URL to a local favicon path, handling Linktree and Instagram URLs specially
 * @param {string} websiteUrl - The website URL
 * @param {string} basePath - The base path (e.g., 'img/favicons')
 * @returns {string} - The local file path
 */
function convertWebsiteUrlToFaviconPath(websiteUrl, basePath = 'img/favicons') {
    if (!websiteUrl || !websiteUrl.startsWith('http')) {
        return websiteUrl;
    }
    
    try {
        const parsedUrl = new URL(websiteUrl);
        
        // Check if it's a Linktree URL
        if (parsedUrl.hostname === 'linktr.ee' || parsedUrl.hostname === 'www.linktr.ee') {
            // Generate Linktree-specific filename
            const pathname = parsedUrl.pathname.substring(1); // Remove leading slash
            const cleanPath = pathname
                .replace(/[^a-zA-Z0-9._-]/g, '-') // Replace invalid chars with dashes
                .replace(/-+/g, '-') // Collapse multiple dashes
                .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
            
            const filename = `favicon-linktr.ee-${cleanPath}.ico`;
            return `${basePath}/${filename}`;
        } 
        // Check if it's an Instagram URL
        else if (parsedUrl.hostname === 'instagram.com' || parsedUrl.hostname === 'www.instagram.com') {
            // Generate Instagram-specific filename
            const pathname = parsedUrl.pathname.substring(1); // Remove leading slash
            const username = pathname.split('/')[0]; // Get username from path
            const cleanUsername = username
                .replace(/[^a-zA-Z0-9._-]/g, '-') // Replace invalid chars with dashes
                .replace(/-+/g, '-') // Collapse multiple dashes
                .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
            
            const filename = `favicon-instagram-${cleanUsername}.ico`;
            return `${basePath}/${filename}`;
        } else {
            // Use regular favicon logic for other domains
            const hostname = parsedUrl.hostname;
            const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
            return convertFaviconUrlToLocalPath(googleFaviconUrl, basePath);
        }
    } catch (error) {
        return websiteUrl; // Return original URL as fallback
    }
}


/**
 * Check if a URL is an Instagram profile URL
 * @param {string} url - URL to check
 * @returns {boolean} - True if Instagram profile URL
 */
function isInstagramUrl(url) {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.hostname === 'instagram.com' || 
               parsedUrl.hostname === 'www.instagram.com';
    } catch {
        return false;
    }
}

/**
 * Extract username from Instagram URL
 * @param {string} url - Instagram URL
 * @returns {string|null} - Username or null if not valid
 */
function extractInstagramUsername(url) {
    try {
        const parsedUrl = new URL(url);
        if (isInstagramUrl(url)) {
            const pathname = parsedUrl.pathname;
            const match = pathname.match(/^\/([^\/\?]+)/);
            return match ? match[1] : null;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Generate filename for Instagram profile picture
 * @param {string} username - Instagram username
 * @param {string} format - Image format (jpeg, png, etc.)
 * @returns {string} - Generated filename
 */
function generateInstagramProfileFilename(username, format = 'jpeg') {
    const cleanUsername = username.replace('@', '').replace(/[^a-zA-Z0-9._-]/g, '-');
    const ext = format === 'jpeg' ? 'jpg' : format;
    return `instagram-${cleanUsername}.${ext}`;
}

/**
 * Convert Instagram profile picture URL to local path
 * @param {string} username - Instagram username
 * @param {string} basePath - Base path for images
 * @returns {string} - Local file path
 */
function convertInstagramProfileToLocalPath(username, basePath = 'img/instagram') {
    const filename = generateInstagramProfileFilename(username);
    return `${basePath}/${filename}`;
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
        convertWebsiteUrlToFaviconPath,
        isInstagramUrl,
        extractInstagramUsername,
        generateInstagramProfileFilename,
        convertInstagramProfileToLocalPath,
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
        convertWebsiteUrlToFaviconPath,
        isInstagramUrl,
        extractInstagramUsername,
        generateInstagramProfileFilename,
        convertInstagramProfileToLocalPath,
        simpleHash
    };
}
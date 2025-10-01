/**
 * Instagram Profile Picture Utilities
 * Handles extraction, downloading, and compression of Instagram profile pictures
 * Similar to linktree profile picture handling but for Instagram
 */

class InstagramProfileUtils {
    constructor() {
        this.cache = new Map();
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second
        
        logger.componentInit('INSTAGRAM', 'Instagram Profile Utils initialized');
    }

    /**
     * Extract Instagram profile picture URL from username
     * @param {string} username - Instagram username (with or without @)
     * @returns {Promise<Object>} - Profile picture data
     */
    async getProfilePicture(username) {
        try {
            // Clean username
            const cleanUsername = username.replace('@', '').trim();
            
            if (!cleanUsername) {
                throw new Error('Username is required');
            }

            // Check cache first
            if (this.cache.has(cleanUsername)) {
                logger.debug('INSTAGRAM', 'Using cached profile picture', { username: cleanUsername });
                return this.cache.get(cleanUsername);
            }

            logger.apiCall('INSTAGRAM', 'Extracting profile picture', { username: cleanUsername });

            // Try multiple methods
            const methods = [
                () => this.method1_PublicAPI(cleanUsername),
                () => this.method2_WebScraping(cleanUsername),
                () => this.method3_AlternativeAPI(cleanUsername)
            ];

            for (let i = 0; i < methods.length; i++) {
                try {
                    const result = await this.retryWithBackoff(methods[i], this.maxRetries);
                    if (result && result.url) {
                        // Cache the result
                        this.cache.set(cleanUsername, result);
                        
                        logger.componentLoad('INSTAGRAM', 'Profile picture extracted successfully', {
                            username: cleanUsername,
                            method: result.method,
                            url: result.url
                        });
                        
                        return result;
                    }
                } catch (error) {
                    logger.warn('INSTAGRAM', `Method ${i + 1} failed`, {
                        username: cleanUsername,
                        error: error.message
                    });
                }
            }

            throw new Error('All extraction methods failed');
        } catch (error) {
            logger.componentError('INSTAGRAM', 'Failed to extract profile picture', {
                username: username,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Method 1: Try Instagram's public API
     */
    async method1_PublicAPI(username) {
        const url = `https://www.instagram.com/${username}/?__a=1&__d=dis`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.graphql && data.graphql.user && data.graphql.user.profile_pic_url_hd) {
            return {
                url: data.graphql.user.profile_pic_url_hd,
                method: 'Public API',
                username: data.graphql.user.username,
                fullName: data.graphql.user.full_name,
                isVerified: data.graphql.user.is_verified || false
            };
        }

        throw new Error('Profile picture not found in API response');
    }

    /**
     * Method 2: Web scraping approach
     */
    async method2_WebScraping(username) {
        const url = `https://www.instagram.com/${username}/`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        
        // Look for profile picture in meta tags
        const metaMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
        if (metaMatch) {
            return {
                url: metaMatch[1],
                method: 'Web Scraping (Meta)',
                username: username
            };
        }

        // Look for profile picture in script tags
        const scriptMatch = html.match(/"profile_pic_url_hd":"([^"]+)"/);
        if (scriptMatch) {
            return {
                url: scriptMatch[1].replace(/\\u0026/g, '&'),
                method: 'Web Scraping (Script)',
                username: username
            };
        }

        // Look for profile picture in other script patterns
        const altScriptMatch = html.match(/"profile_pic_url":"([^"]+)"/);
        if (altScriptMatch) {
            return {
                url: altScriptMatch[1].replace(/\\u0026/g, '&'),
                method: 'Web Scraping (Alt Script)',
                username: username
            };
        }

        throw new Error('Profile picture not found in HTML');
    }

    /**
     * Method 3: Alternative API approach
     */
    async method3_AlternativeAPI(username) {
        const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        if (data.data && data.data.user && data.data.user.profile_pic_url_hd) {
            return {
                url: data.data.user.profile_pic_url_hd,
                method: 'Alternative API',
                username: data.data.user.username,
                fullName: data.data.user.full_name,
                isVerified: data.data.user.is_verified || false
            };
        }

        throw new Error('Profile picture not found in alternative API');
    }

    /**
     * Retry function with exponential backoff
     */
    async retryWithBackoff(fn, maxRetries) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (attempt === maxRetries) {
                    throw error;
                }
                
                const delay = this.retryDelay * Math.pow(2, attempt - 1);
                logger.debug('INSTAGRAM', `Retry attempt ${attempt}/${maxRetries} in ${delay}ms`, {
                    error: error.message
                });
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /**
     * Download and compress Instagram profile picture
     * @param {string} imageUrl - The profile picture URL
     * @param {string} username - Instagram username for filename
     * @param {Object} options - Compression options
     * @returns {Promise<Object>} - Download and compression result
     */
    async downloadAndCompress(imageUrl, username, options = {}) {
        try {
            logger.time('INSTAGRAM', 'download and compress');
            
            const {
                maxWidth = 200,
                maxHeight = 200,
                quality = 0.8,
                format = 'jpeg'
            } = options;

            // Download the image
            const response = await fetch(imageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to download image: HTTP ${response.status}`);
            }

            const blob = await response.blob();
            const originalSize = blob.size;

            // Compress the image
            const compressedResult = await this.compressImage(blob, {
                maxWidth,
                maxHeight,
                quality,
                format
            });

            // Generate filename
            const filename = this.generateInstagramFilename(username, format);

            logger.timeEnd('INSTAGRAM', 'download and compress');

            return {
                filename,
                originalSize,
                compressedSize: compressedResult.blob.size,
                compressionRatio: ((originalSize - compressedResult.blob.size) / originalSize * 100).toFixed(2),
                dataUrl: compressedResult.dataUrl,
                blob: compressedResult.blob,
                url: imageUrl,
                username: username
            };

        } catch (error) {
            logger.componentError('INSTAGRAM', 'Failed to download and compress image', {
                imageUrl,
                username,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Compress an image using Canvas API
     * @param {Blob} imageBlob - The image blob to compress
     * @param {Object} options - Compression options
     * @returns {Promise<Object>} - Compressed image data
     */
    async compressImage(imageBlob, options = {}) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            img.onload = () => {
                try {
                    // Calculate new dimensions
                    const { width, height } = this.calculateDimensions(
                        img.width,
                        img.height,
                        options.maxWidth || 200,
                        options.maxHeight || 200
                    );

                    canvas.width = width;
                    canvas.height = height;

                    // Draw and compress
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    const quality = options.quality || 0.8;
                    const format = options.format || 'jpeg';
                    const mimeType = `image/${format}`;
                    
                    const dataUrl = canvas.toDataURL(mimeType, quality);
                    
                    // Convert to blob
                    canvas.toBlob((blob) => {
                        resolve({
                            blob,
                            dataUrl,
                            width,
                            height
                        });
                    }, mimeType, quality);

                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = () => reject(new Error('Failed to load image for compression'));
            img.src = URL.createObjectURL(imageBlob);
        });
    }

    /**
     * Calculate new dimensions maintaining aspect ratio
     */
    calculateDimensions(originalWidth, originalHeight, maxWidth, maxHeight) {
        let width = originalWidth;
        let height = originalHeight;

        // Calculate aspect ratio
        const aspectRatio = originalWidth / originalHeight;

        if (width > maxWidth) {
            width = maxWidth;
            height = width / aspectRatio;
        }

        if (height > maxHeight) {
            height = maxHeight;
            width = height * aspectRatio;
        }

        return { 
            width: Math.round(width), 
            height: Math.round(height) 
        };
    }

    /**
     * Generate filename for Instagram profile picture
     * @param {string} username - Instagram username
     * @param {string} format - Image format (jpeg, png, etc.)
     * @returns {string} - Generated filename
     */
    generateInstagramFilename(username, format = 'jpeg') {
        const cleanUsername = username.replace('@', '').replace(/[^a-zA-Z0-9._-]/g, '-');
        const ext = format === 'jpeg' ? 'jpg' : format;
        return `instagram-${cleanUsername}.${ext}`;
    }

    /**
     * Generate local path for Instagram profile picture
     * @param {string} username - Instagram username
     * @param {string} basePath - Base path for images
     * @returns {string} - Local file path
     */
    generateLocalPath(username, basePath = 'img/instagram') {
        const filename = this.generateInstagramFilename(username);
        return `${basePath}/${filename}`;
    }

    /**
     * Check if a URL is an Instagram profile URL
     * @param {string} url - URL to check
     * @returns {boolean} - True if Instagram profile URL
     */
    isInstagramUrl(url) {
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
    extractUsernameFromUrl(url) {
        try {
            const parsedUrl = new URL(url);
            if (this.isInstagramUrl(url)) {
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
     * Create Instagram profile card HTML (similar to linktree cards)
     * @param {Object} profileData - Profile data from getProfilePicture
     * @param {Object} options - Display options
     * @returns {string} - HTML for profile card
     */
    createProfileCard(profileData, options = {}) {
        const {
            showFullName = true,
            showUsername = true,
            showVerified = true,
            cardClass = 'instagram-profile-card',
            imageClass = 'instagram-profile-image'
        } = options;

        const { url, username, fullName, isVerified } = profileData;

        return `
            <div class="${cardClass}" data-instagram-username="${username}">
                <img src="${url}" 
                     alt="${fullName || username}'s profile picture" 
                     class="${imageClass}"
                     onerror="this.style.display='none'">
                ${showFullName && fullName ? `<h3>${fullName}</h3>` : ''}
                ${showUsername ? `<p>@${username}${isVerified ? ' ✓' : ''}</p>` : ''}
                <a href="https://instagram.com/${username}" 
                   target="_blank" 
                   rel="noopener" 
                   class="instagram-link">
                    📷 View on Instagram
                </a>
            </div>
        `;
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        logger.debug('INSTAGRAM', 'Cache cleared');
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.InstagramProfileUtils = InstagramProfileUtils;
}

// Export for Node.js (CommonJS)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InstagramProfileUtils;
}
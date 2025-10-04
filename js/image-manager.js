/**
 * Image Management System
 * Handles organization, tracking, and cleanup of event images
 */

class ImageManager {
    constructor() {
        this.basePath = 'img/events';
        this.metadataFile = 'metadata.json';
        this.primaryImageName = 'primary.jpg';
        this.galleryDir = 'gallery';
        
        // Initialize logger if available
        this.logger = window.logger || {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {}
        };
    }

    /**
     * Generate a clean event ID from event data
     * @param {Object} eventData - Event data object
     * @returns {string} - Clean event ID
     */
    generateEventId(eventData) {
        if (!eventData) return null;
        
        // Try to use existing ID fields first
        if (eventData.id) return this.sanitizeId(eventData.id);
        if (eventData.uid) return this.sanitizeId(eventData.uid);
        
        // Generate from name and date
        const name = eventData.name || eventData.title || 'unknown-event';
        const date = eventData.startDate || eventData.date || new Date().toISOString().split('T')[0];
        
        const cleanName = name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .substring(0, 30);
        
        const cleanDate = date.replace(/[^0-9-]/g, '').substring(0, 10);
        
        return `${cleanName}-${cleanDate}`;
    }

    /**
     * Sanitize an ID string for use in filenames
     * @param {string} id - Raw ID string
     * @returns {string} - Sanitized ID
     */
    sanitizeId(id) {
        return String(id)
            .replace(/[^a-zA-Z0-9._-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 50);
    }

    /**
     * Get the folder path for an event
     * @param {string} eventId - Event ID
     * @returns {string} - Folder path
     */
    getEventFolderPath(eventId) {
        return `${this.basePath}/${eventId}`;
    }

    /**
     * Get the primary image path for an event
     * @param {string} eventId - Event ID
     * @returns {string} - Primary image path
     */
    getPrimaryImagePath(eventId) {
        return `${this.getEventFolderPath(eventId)}/${this.primaryImageName}`;
    }

    /**
     * Get the gallery directory path for an event
     * @param {string} eventId - Event ID
     * @returns {string} - Gallery directory path
     */
    getGalleryPath(eventId) {
        return `${this.getEventFolderPath(eventId)}/${this.galleryDir}`;
    }

    /**
     * Get the metadata file path for an event
     * @param {string} eventId - Event ID
     * @returns {string} - Metadata file path
     */
    getMetadataPath(eventId) {
        return `${this.getEventFolderPath(eventId)}/${this.metadataFile}`;
    }

    /**
     * Load metadata for an event
     * @param {string} eventId - Event ID
     * @returns {Object|null} - Event metadata or null if not found
     */
    loadEventMetadata(eventId) {
        try {
            const metadataPath = this.getMetadataPath(eventId);
            // In browser environment, we can't directly read files
            // This would need to be implemented via API or server-side
            this.logger.warn('IMAGE', 'loadEventMetadata not implemented for browser environment');
            return null;
        } catch (error) {
            this.logger.error('IMAGE', 'Failed to load event metadata', { eventId, error: error.message });
            return null;
        }
    }

    /**
     * Save metadata for an event
     * @param {string} eventId - Event ID
     * @param {Object} metadata - Event metadata
     * @returns {boolean} - Success status
     */
    saveEventMetadata(eventId, metadata) {
        try {
            const metadataPath = this.getMetadataPath(eventId);
            // In browser environment, we can't directly write files
            // This would need to be implemented via API or server-side
            this.logger.warn('IMAGE', 'saveEventMetadata not implemented for browser environment');
            return false;
        } catch (error) {
            this.logger.error('IMAGE', 'Failed to save event metadata', { eventId, error: error.message });
            return false;
        }
    }

    /**
     * Convert an image URL to the new organized structure
     * @param {string} imageUrl - Original image URL
     * @param {Object} eventData - Event data object
     * @param {string} imageType - Type of image ('primary' or 'gallery')
     * @param {number} galleryIndex - Index for gallery images
     * @returns {string} - New organized image path
     */
    convertImageUrlToOrganizedPath(imageUrl, eventData, imageType = 'primary', galleryIndex = 0) {
        if (!imageUrl || !imageUrl.startsWith('http')) {
            return imageUrl;
        }

        const eventId = this.generateEventId(eventData);
        if (!eventId) {
            this.logger.warn('IMAGE', 'Could not generate event ID for image conversion', { eventData });
            return imageUrl;
        }

        if (imageType === 'primary') {
            return this.getPrimaryImagePath(eventId);
        } else if (imageType === 'gallery') {
            const extension = this.getImageExtension(imageUrl);
            const galleryPath = this.getGalleryPath(eventId);
            return `${galleryPath}/image-${galleryIndex + 1}${extension}`;
        }

        return imageUrl;
    }

    /**
     * Extract image extension from URL
     * @param {string} imageUrl - Image URL
     * @returns {string} - File extension
     */
    getImageExtension(imageUrl) {
        try {
            const url = new URL(imageUrl);
            const pathname = url.pathname;
            const ext = pathname.includes('.') ? pathname.substring(pathname.lastIndexOf('.')) : '.jpg';
            return ext;
        } catch (error) {
            return '.jpg';
        }
    }

    /**
     * Generate a clean filename for an image
     * @param {string} imageUrl - Original image URL
     * @param {Object} eventData - Event data object
     * @param {string} imageType - Type of image
     * @param {number} galleryIndex - Index for gallery images
     * @returns {string} - Clean filename
     */
    generateCleanFilename(imageUrl, eventData, imageType = 'primary', galleryIndex = 0) {
        const eventId = this.generateEventId(eventData);
        const extension = this.getImageExtension(imageUrl);
        
        if (imageType === 'primary') {
            return `${eventId}-primary${extension}`;
        } else if (imageType === 'gallery') {
            return `${eventId}-gallery-${galleryIndex + 1}${extension}`;
        }
        
        return `image${extension}`;
    }

    /**
     * Create event metadata object
     * @param {Object} eventData - Event data
     * @param {Array} imageUrls - Array of image URLs
     * @returns {Object} - Metadata object
     */
    createEventMetadata(eventData, imageUrls = []) {
        const eventId = this.generateEventId(eventData);
        const now = new Date().toISOString();
        
        return {
            eventId: eventId,
            eventName: eventData.name || eventData.title || 'Unknown Event',
            eventDate: eventData.startDate || eventData.date || null,
            eventLocation: eventData.location || eventData.venue || null,
            created: now,
            lastUpdated: now,
            images: {
                primary: imageUrls[0] || null,
                gallery: imageUrls.slice(1) || []
            },
            imageCount: imageUrls.length,
            sourceUrls: imageUrls,
            metadata: {
                originalEventData: eventData,
                imageManagerVersion: '1.0.0'
            }
        };
    }

    /**
     * Get all event IDs from the file system
     * This would need server-side implementation
     * @returns {Array} - Array of event IDs
     */
    getAllEventIds() {
        // This would need to be implemented via API call
        this.logger.warn('IMAGE', 'getAllEventIds not implemented for browser environment');
        return [];
    }

    /**
     * Check if an event has images
     * @param {string} eventId - Event ID
     * @returns {boolean} - Whether event has images
     */
    hasEventImages(eventId) {
        // This would need to be implemented via API call
        this.logger.warn('IMAGE', 'hasEventImages not implemented for browser environment');
        return false;
    }

    /**
     * Get all image paths for an event
     * @param {string} eventId - Event ID
     * @returns {Array} - Array of image paths
     */
    getEventImagePaths(eventId) {
        const paths = [];
        const primaryPath = this.getPrimaryImagePath(eventId);
        const galleryPath = this.getGalleryPath(eventId);
        
        // Add primary image
        paths.push(primaryPath);
        
        // Gallery images would need to be discovered via API
        // For now, return just the primary path
        return paths;
    }

    /**
     * Validate event metadata structure
     * @param {Object} metadata - Metadata to validate
     * @returns {boolean} - Whether metadata is valid
     */
    validateMetadata(metadata) {
        if (!metadata || typeof metadata !== 'object') return false;
        
        const requiredFields = ['eventId', 'eventName', 'created', 'images'];
        return requiredFields.every(field => metadata.hasOwnProperty(field));
    }

    /**
     * Update event metadata
     * @param {string} eventId - Event ID
     * @param {Object} updates - Updates to apply
     * @returns {boolean} - Success status
     */
    updateEventMetadata(eventId, updates) {
        try {
            const existingMetadata = this.loadEventMetadata(eventId);
            if (!existingMetadata) {
                this.logger.warn('IMAGE', 'Cannot update metadata for non-existent event', { eventId });
                return false;
            }

            const updatedMetadata = {
                ...existingMetadata,
                ...updates,
                lastUpdated: new Date().toISOString()
            };

            return this.saveEventMetadata(eventId, updatedMetadata);
        } catch (error) {
            this.logger.error('IMAGE', 'Failed to update event metadata', { eventId, error: error.message });
            return false;
        }
    }
}

// Export for browser environment
if (typeof window !== 'undefined') {
    window.ImageManager = ImageManager;
}

// Export for Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageManager;
}
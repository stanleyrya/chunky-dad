#!/usr/bin/env node

/**
 * Image Cleanup Script
 * Identifies and removes unused images from the repository
 */

const fs = require('fs');
const path = require('path');
const { CalendarCore } = require('../js/calendar-core.js');
const ImageManager = require('../js/image-manager.js');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const EVENTS_DIR = path.join(ROOT, 'img', 'events');
const CALENDARS_DIR = path.join(ROOT, 'data', 'calendars');
const BACKUP_DIR = path.join(ROOT, 'img', 'cleanup-backup');

// Mock logger for Node.js environment
const logger = {
    componentInit: (component, message, data) => console.log(`[${component}] ${message}`, data || ''),
    componentLoad: (component, message, data) => console.log(`[${component}] ${message}`, data || ''),
    componentError: (component, message, data) => console.error(`[${component}] ERROR: ${message}`, data || ''),
    info: (component, message, data) => console.log(`[${component}] ${message}`, data || ''),
    debug: (component, message, data) => console.log(`[${component}] DEBUG: ${message}`, data || ''),
    warn: (component, message, data) => console.warn(`[${component}] WARN: ${message}`, data || ''),
    error: (component, message, data) => console.error(`[${component}] ERROR: ${message}`, data || ''),
    time: (component, label) => console.time(`[${component}] ${label}`),
    timeEnd: (component, label) => console.timeEnd(`[${component}] ${label}`),
    apiCall: (component, message, data) => console.log(`[${component}] API: ${message}`, data || '')
};

// Initialize image manager
const imageManager = new ImageManager();

// Ensure directories exist
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Load all events from calendar files
function loadAllEvents() {
    console.log('📅 Loading events from calendar files...');
    
    const events = [];
    const calendarCore = new CalendarCore();
    
    if (!fs.existsSync(CALENDARS_DIR)) {
        console.log('⚠️  No calendars directory found');
        return events;
    }
    
    const calendarFiles = fs.readdirSync(CALENDARS_DIR).filter(file => file.endsWith('.ics'));
    
    for (const file of calendarFiles) {
        const filePath = path.join(CALENDARS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        console.log(`   Processing: ${file}`);
        
        try {
            const fileEvents = calendarCore.parseICalData(content);
            events.push(...fileEvents);
            console.log(`   Found ${fileEvents.length} events`);
        } catch (error) {
            console.error(`   ❌ Failed to parse ${file}:`, error.message);
        }
    }
    
    console.log(`📊 Total events loaded: ${events.length}`);
    return events;
}

// Get all image files in the events directory
function getAllImageFiles() {
    console.log('🖼️  Scanning for image files...');
    
    const imageFiles = [];
    
    if (!fs.existsSync(EVENTS_DIR)) {
        console.log('⚠️  No events directory found');
        return imageFiles;
    }
    
    function scanDirectory(dir, relativePath = '') {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
            const itemPath = path.join(dir, item);
            const relativeItemPath = path.join(relativePath, item);
            const stat = fs.statSync(itemPath);
            
            if (stat.isDirectory()) {
                // Recursively scan subdirectories
                scanDirectory(itemPath, relativeItemPath);
            } else if (stat.isFile()) {
                const ext = path.extname(item).toLowerCase();
                if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                    imageFiles.push({
                        file: item,
                        path: itemPath,
                        relativePath: relativeItemPath,
                        size: stat.size,
                        lastModified: stat.mtime
                    });
                }
            }
        }
    }
    
    scanDirectory(EVENTS_DIR);
    
    console.log(`📊 Found ${imageFiles.length} image files`);
    return imageFiles;
}

// Check if an image is referenced by any event
function isImageReferenced(imageFile, events) {
    const imagePath = imageFile.relativePath;
    
    for (const event of events) {
        if (!event.image) continue;
        
        // Check if the image path matches the event's image
        if (imagePath.includes(event.image) || event.image.includes(imagePath)) {
            return true;
        }
        
        // Check if the image is in the event's folder
        const eventId = imageManager.generateEventId(event);
        if (eventId && imagePath.startsWith(eventId)) {
            return true;
        }
    }
    
    return false;
}

// Find unused images
function findUnusedImages(events, imageFiles) {
    console.log('🔍 Checking for unused images...');
    
    const unusedImages = [];
    const usedImages = [];
    
    for (const imageFile of imageFiles) {
        if (isImageReferenced(imageFile, events)) {
            usedImages.push(imageFile);
        } else {
            unusedImages.push(imageFile);
        }
    }
    
    console.log(`📊 Found ${usedImages.length} used images`);
    console.log(`📊 Found ${unusedImages.length} unused images`);
    
    return { usedImages, unusedImages };
}

// Create backup of images before deletion
function createBackup(images) {
    console.log('📦 Creating backup of images to be deleted...');
    
    ensureDir(BACKUP_DIR);
    
    for (const image of images) {
        const backupPath = path.join(BACKUP_DIR, image.relativePath);
        const backupDir = path.dirname(backupPath);
        
        ensureDir(backupDir);
        fs.copyFileSync(image.path, backupPath);
    }
    
    console.log(`✅ Backup created: ${images.length} images backed up to ${BACKUP_DIR}`);
}

// Delete unused images
function deleteUnusedImages(unusedImages, createBackupFirst = true) {
    console.log('🗑️  Deleting unused images...');
    
    if (createBackupFirst) {
        createBackup(unusedImages);
    }
    
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const image of unusedImages) {
        try {
            fs.unlinkSync(image.path);
            deletedCount++;
            console.log(`   ✅ Deleted: ${image.relativePath}`);
        } catch (error) {
            console.error(`   ❌ Failed to delete ${image.relativePath}:`, error.message);
            errorCount++;
        }
    }
    
    console.log(`📊 Deletion complete: ${deletedCount} deleted, ${errorCount} errors`);
}

// Generate cleanup report
function generateCleanupReport(usedImages, unusedImages) {
    console.log('📋 Generating cleanup report...');
    
    const reportPath = path.join(ROOT, 'image-cleanup-report.json');
    const totalUsedSize = usedImages.reduce((total, img) => total + img.size, 0);
    const totalUnusedSize = unusedImages.reduce((total, img) => total + img.size, 0);
    
    const report = {
        generated: new Date().toISOString(),
        summary: {
            totalImages: usedImages.length + unusedImages.length,
            usedImages: usedImages.length,
            unusedImages: unusedImages.length,
            totalUsedSize: totalUsedSize,
            totalUnusedSize: totalUnusedSize,
            spaceSavings: totalUnusedSize
        },
        usedImages: usedImages.map(img => ({
            file: img.file,
            path: img.relativePath,
            size: img.size,
            lastModified: img.lastModified
        })),
        unusedImages: unusedImages.map(img => ({
            file: img.file,
            path: img.relativePath,
            size: img.size,
            lastModified: img.lastModified
        })),
        recommendations: [
            'Review unused images to ensure they are not needed',
            'Consider archiving old images before deletion',
            'Run with --delete flag to remove confirmed unused images'
        ]
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Cleanup report saved: ${reportPath}`);
    console.log(`📊 Space savings: ${Math.round(totalUnusedSize / 1024 / 1024 * 100) / 100} MB`);
}

// Main cleanup function
async function main() {
    const args = process.argv.slice(2);
    const shouldDelete = args.includes('--delete');
    const skipBackup = args.includes('--no-backup');
    
    console.log('🧹 Starting image cleanup process...');
    
    if (shouldDelete) {
        console.log('⚠️  DELETE mode enabled - unused images will be deleted');
        if (!skipBackup) {
            console.log('📦 Backup will be created before deletion');
        }
    } else {
        console.log('🔍 DRY RUN mode - no images will be deleted');
    }
    
    try {
        // Step 1: Load all events
        const events = loadAllEvents();
        
        // Step 2: Get all image files
        const imageFiles = getAllImageFiles();
        
        // Step 3: Find unused images
        const { usedImages, unusedImages } = findUnusedImages(events, imageFiles);
        
        // Step 4: Generate report
        generateCleanupReport(usedImages, unusedImages);
        
        // Step 5: Delete unused images if requested
        if (shouldDelete && unusedImages.length > 0) {
            deleteUnusedImages(unusedImages, !skipBackup);
        } else if (unusedImages.length > 0) {
            console.log('');
            console.log('To delete unused images, run:');
            console.log('  node tools/cleanup-unused-images.js --delete');
            console.log('');
            console.log('To skip backup:');
            console.log('  node tools/cleanup-unused-images.js --delete --no-backup');
        }
        
        console.log('🎉 Image cleanup completed successfully!');
        
    } catch (error) {
        console.error('💥 Cleanup failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Fatal error during cleanup:', error);
        process.exit(1);
    });
}

module.exports = { main, loadAllEvents, getAllImageFiles, findUnusedImages, deleteUnusedImages, generateCleanupReport };
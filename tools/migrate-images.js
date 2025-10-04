#!/usr/bin/env node

/**
 * Image Migration Script
 * Migrates existing flat image structure to new organized event-based structure
 */

const fs = require('fs');
const path = require('path');
const { CalendarCore } = require('../js/calendar-core.js');
const ImageManager = require('../js/image-manager.js');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');
const OLD_EVENTS_DIR = path.join(ROOT, 'img', 'events');
const NEW_EVENTS_DIR = path.join(ROOT, 'img', 'events');
const CALENDARS_DIR = path.join(ROOT, 'data', 'calendars');
const BACKUP_DIR = path.join(ROOT, 'img', 'events-backup');

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

// Create backup of existing images
function createBackup() {
    console.log('📦 Creating backup of existing images...');
    
    if (fs.existsSync(OLD_EVENTS_DIR)) {
        ensureDir(BACKUP_DIR);
        
        // Copy all files from old directory to backup
        const files = fs.readdirSync(OLD_EVENTS_DIR);
        for (const file of files) {
            const srcPath = path.join(OLD_EVENTS_DIR, file);
            const destPath = path.join(BACKUP_DIR, file);
            
            if (fs.statSync(srcPath).isFile()) {
                fs.copyFileSync(srcPath, destPath);
            }
        }
        
        console.log(`✅ Backup created: ${files.length} files backed up to ${BACKUP_DIR}`);
    } else {
        console.log('⚠️  No existing images directory found, skipping backup');
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

// Find image files that match event data
function findMatchingImages(events) {
    console.log('🔍 Finding matching images for events...');
    
    const imageMatches = new Map();
    const orphanedImages = [];
    
    if (!fs.existsSync(OLD_EVENTS_DIR)) {
        console.log('⚠️  No existing images directory found');
        return { imageMatches, orphanedImages };
    }
    
    const imageFiles = fs.readdirSync(OLD_EVENTS_DIR).filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    });
    
    console.log(`   Found ${imageFiles.length} image files`);
    
    // Load metadata files to get original URLs
    const metadataFiles = fs.readdirSync(OLD_EVENTS_DIR).filter(file => file.endsWith('.meta'));
    const metadataMap = new Map();
    
    for (const metaFile of metadataFiles) {
        try {
            const metaPath = path.join(OLD_EVENTS_DIR, metaFile);
            const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const imageFile = metaFile.replace('.meta', '');
            metadataMap.set(imageFile, metadata);
        } catch (error) {
            console.warn(`   ⚠️  Failed to load metadata for ${metaFile}:`, error.message);
        }
    }
    
    // Match images to events
    for (const event of events) {
        if (!event.image) continue;
        
        const eventId = imageManager.generateEventId(event);
        if (!eventId) continue;
        
        // Try to find matching image by URL
        for (const imageFile of imageFiles) {
            const metadata = metadataMap.get(imageFile);
            if (metadata && metadata.originalUrl === event.image) {
                const imagePath = path.join(OLD_EVENTS_DIR, imageFile);
                const metaPath = path.join(OLD_EVENTS_DIR, imageFile + '.meta');
                
                if (!imageMatches.has(eventId)) {
                    imageMatches.set(eventId, {
                        event: event,
                        eventId: eventId,
                        images: []
                    });
                }
                
                imageMatches.get(eventId).images.push({
                    originalFile: imageFile,
                    imagePath: imagePath,
                    metaPath: metaPath,
                    metadata: metadata
                });
                
                console.log(`   ✅ Matched: ${imageFile} -> ${eventId}`);
                break;
            }
        }
    }
    
    // Find orphaned images
    const matchedFiles = new Set();
    for (const match of imageMatches.values()) {
        for (const img of match.images) {
            matchedFiles.add(img.originalFile);
        }
    }
    
    for (const imageFile of imageFiles) {
        if (!matchedFiles.has(imageFile)) {
            const imagePath = path.join(OLD_EVENTS_DIR, imageFile);
            const metaPath = path.join(OLD_EVENTS_DIR, imageFile + '.meta');
            orphanedImages.push({
                file: imageFile,
                path: imagePath,
                metaPath: metaPath
            });
        }
    }
    
    console.log(`📊 Matched ${imageMatches.size} events with images`);
    console.log(`📊 Found ${orphanedImages.length} orphaned images`);
    
    return { imageMatches, orphanedImages };
}

// Migrate images to new structure
function migrateImages(imageMatches) {
    console.log('🔄 Migrating images to new structure...');
    
    let migratedCount = 0;
    let errorCount = 0;
    
    for (const [eventId, match] of imageMatches) {
        try {
            console.log(`   Migrating event: ${eventId}`);
            
            // Create event directory
            const eventDir = path.join(NEW_EVENTS_DIR, eventId);
            ensureDir(eventDir);
            
            // Create gallery directory
            const galleryDir = path.join(eventDir, 'gallery');
            ensureDir(galleryDir);
            
            // Migrate images
            for (let i = 0; i < match.images.length; i++) {
                const img = match.images[i];
                const isPrimary = i === 0;
                const destFileName = isPrimary ? 'primary.jpg' : `image-${i}.jpg`;
                const destPath = path.join(eventDir, destFileName);
                
                // Copy image file
                if (fs.existsSync(img.imagePath)) {
                    fs.copyFileSync(img.imagePath, destPath);
                    console.log(`     ✅ Copied: ${img.originalFile} -> ${destFileName}`);
                }
                
                // Copy metadata if it exists
                if (fs.existsSync(img.metaPath)) {
                    const destMetaPath = destPath + '.meta';
                    fs.copyFileSync(img.metaPath, destMetaPath);
                }
            }
            
            // Create event metadata
            const eventMetadata = imageManager.createEventMetadata(match.event, match.images.map(img => img.metadata.originalUrl));
            const metadataPath = path.join(eventDir, 'metadata.json');
            fs.writeFileSync(metadataPath, JSON.stringify(eventMetadata, null, 2));
            
            migratedCount++;
            console.log(`   ✅ Migrated event: ${eventId} (${match.images.length} images)`);
            
        } catch (error) {
            console.error(`   ❌ Failed to migrate event ${eventId}:`, error.message);
            errorCount++;
        }
    }
    
    console.log(`📊 Migration complete: ${migratedCount} events migrated, ${errorCount} errors`);
}

// Generate cleanup report
function generateCleanupReport(orphanedImages) {
    console.log('📋 Generating cleanup report...');
    
    const reportPath = path.join(ROOT, 'image-cleanup-report.json');
    const report = {
        generated: new Date().toISOString(),
        orphanedImages: orphanedImages.map(img => ({
            file: img.file,
            size: fs.existsSync(img.path) ? fs.statSync(img.path).size : 0,
            lastModified: fs.existsSync(img.path) ? fs.statSync(img.path).mtime : null
        })),
        totalOrphanedSize: orphanedImages.reduce((total, img) => {
            return total + (fs.existsSync(img.path) ? fs.statSync(img.path).size : 0);
        }, 0),
        recommendations: [
            'Review orphaned images to ensure they are not needed',
            'Consider archiving old images before deletion',
            'Run cleanup script to remove confirmed orphaned images'
        ]
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Cleanup report saved: ${reportPath}`);
    console.log(`📊 Found ${orphanedImages.length} orphaned images (${Math.round(report.totalOrphanedSize / 1024 / 1024 * 100) / 100} MB)`);
}

// Main migration function
async function main() {
    console.log('🚀 Starting image migration process...');
    
    try {
        // Step 1: Create backup
        createBackup();
        
        // Step 2: Load all events
        const events = loadAllEvents();
        
        // Step 3: Find matching images
        const { imageMatches, orphanedImages } = findMatchingImages(events);
        
        // Step 4: Migrate images
        if (imageMatches.size > 0) {
            migrateImages(imageMatches);
        } else {
            console.log('⚠️  No images to migrate');
        }
        
        // Step 5: Generate cleanup report
        if (orphanedImages.length > 0) {
            generateCleanupReport(orphanedImages);
        }
        
        console.log('🎉 Image migration completed successfully!');
        console.log('');
        console.log('Next steps:');
        console.log('1. Review the cleanup report: image-cleanup-report.json');
        console.log('2. Test the new image structure');
        console.log('3. Update your calendar loader to use the new structure');
        console.log('4. Run cleanup script to remove orphaned images');
        
    } catch (error) {
        console.error('💥 Migration failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Fatal error during migration:', error);
        process.exit(1);
    });
}

module.exports = { main, createBackup, loadAllEvents, findMatchingImages, migrateImages, generateCleanupReport };
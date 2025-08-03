/**
 * Event Structure Definition and Utilities
 * 
 * This file defines the standardized event object structure and provides
 * utilities for merging conflicting events and extracting important information.
 * 
 * ENVIRONMENT: Pure JavaScript - NO Scriptable APIs, NO DOM APIs
 */

// Standard event structure with clear categories
const EVENT_STRUCTURE = {
  // Core Information
  title: '',              // Event title
  shortTitle: '',         // Abbreviated title for display
  startDate: '',          // ISO 8601 date string
  endDate: '',            // ISO 8601 date string
  
  // Location Information
  venue: '',              // Venue/bar name
  address: '',            // Full street address
  city: '',               // City code (e.g., 'la', 'nyc')
  coordinates: {          // GPS coordinates
    lat: '',
    lng: ''
  },
  
  // Event Details
  description: '',        // Event description
  tea: '',                // Special notes/insider info (extracted from notes)
  price: '',              // Ticket price or entry fee
  
  // Links and References
  url: '',                // Primary event URL
  instagram: '',          // Instagram profile URL
  website: '',            // Official website
  image: '',              // Event image URL
  googleMapsLink: '',     // Direct Google Maps link
  
  // Metadata
  key: '',                // Unique event identifier
  source: '',             // Data source (e.g., 'eventbrite')
  parser: '',             // Parser name
  isBearEvent: true,      // Bear event flag
  
  // Processing Information (prefixed with _)
  _action: '',            // Processing action (new, update, merge, conflict)
  _conflicts: [],         // Array of conflicting events
  _merged: false,         // Whether this event has been merged with conflicts
  _parserConfig: {},      // Parser configuration
  _fieldMergeStrategies: {} // Field-specific merge strategies
};

/**
 * Extract "Tea" (insider information) from notes field
 * Looks for patterns like "Tea: ..." in the notes
 */
function extractTea(notes) {
  if (!notes) return '';
  
  // Look for "Tea:" pattern (case insensitive)
  const teaMatch = notes.match(/tea:\s*(.+?)(?:\n|$)/i);
  if (teaMatch) {
    return teaMatch[1].trim();
  }
  
  return '';
}

/**
 * Extract Instagram URL from notes or other fields
 */
function extractInstagram(notes, existingInstagram) {
  if (existingInstagram) return existingInstagram;
  if (!notes) return '';
  
  // Look for Instagram URLs in notes
  const instagramMatch = notes.match(/instagram\.com\/[^\s\n]+/i);
  if (instagramMatch) {
    // Ensure it's a full URL
    const url = instagramMatch[0];
    return url.startsWith('http') ? url : `https://${url}`;
  }
  
  return '';
}

/**
 * Merge conflicting events intelligently
 * Extracts important information from conflicts and merges into main event
 */
function mergeConflictingEvents(mainEvent, conflicts) {
  if (!conflicts || conflicts.length === 0) return mainEvent;
  
  const merged = { ...mainEvent };
  
  // Extract tea from all conflicting events
  const teas = [];
  if (merged.tea) teas.push(merged.tea);
  
  conflicts.forEach(conflict => {
    // Extract tea from conflict notes
    const conflictTea = extractTea(conflict.notes);
    if (conflictTea && !teas.includes(conflictTea)) {
      teas.push(conflictTea);
    }
    
    // Extract Instagram if not already present
    if (!merged.instagram && conflict.notes) {
      merged.instagram = extractInstagram(conflict.notes, conflict.instagram);
    }
    
    // Merge venue/location info if missing
    if (!merged.venue && conflict.location) {
      merged.venue = conflict.location;
    }
    
    // Use the earliest start time and latest end time
    if (conflict.startDate && new Date(conflict.startDate) < new Date(merged.startDate)) {
      merged.startDate = conflict.startDate;
    }
    if (conflict.endDate && new Date(conflict.endDate) > new Date(merged.endDate)) {
      merged.endDate = conflict.endDate;
    }
  });
  
  // Combine all tea information
  if (teas.length > 0) {
    merged.tea = teas.join(' | ');
  }
  
  // Mark as merged
  merged._merged = true;
  
  return merged;
}

/**
 * Clean and standardize an event object
 * Removes redundant fields and ensures consistent structure
 */
function cleanEventObject(rawEvent) {
  const clean = {};
  
  // Core Information
  clean.title = rawEvent.title || '';
  clean.shortTitle = rawEvent.shortTitle || rawEvent.shortName || '';
  clean.startDate = rawEvent.startDate || '';
  clean.endDate = rawEvent.endDate || rawEvent.startDate || '';
  
  // Location Information
  clean.venue = rawEvent.venue || rawEvent.bar || rawEvent.location || 'TBA';
  clean.address = rawEvent.address || '';
  clean.city = rawEvent.city || rawEvent.debugCity || '';
  
  // Handle coordinates
  if (rawEvent.coordinates) {
    clean.coordinates = typeof rawEvent.coordinates === 'object' 
      ? rawEvent.coordinates 
      : parseCoordinates(rawEvent.coordinates);
  } else if (rawEvent.location && rawEvent.location.match(/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/)) {
    clean.coordinates = parseCoordinates(rawEvent.location);
  } else {
    clean.coordinates = { lat: '', lng: '' };
  }
  
  // Event Details
  clean.description = rawEvent.description || '';
  clean.tea = rawEvent.tea || extractTea(rawEvent.notes) || '';
  clean.price = rawEvent.price || '';
  
  // Links and References
  clean.url = rawEvent.url || rawEvent.website || '';
  clean.instagram = rawEvent.instagram || extractInstagram(rawEvent.notes) || '';
  clean.website = rawEvent.website || rawEvent.url || '';
  clean.image = rawEvent.image || rawEvent.debugImage || '';
  clean.googleMapsLink = rawEvent.googleMapsLink || rawEvent.gmaps || '';
  
  // Metadata
  clean.key = rawEvent.key || '';
  clean.source = rawEvent.source || rawEvent.debugSource || '';
  clean.parser = rawEvent.parser || rawEvent._parserConfig?.name || '';
  clean.isBearEvent = rawEvent.isBearEvent !== false;
  
  // Processing Information
  if (rawEvent._action) clean._action = rawEvent._action;
  if (rawEvent._conflicts) clean._conflicts = rawEvent._conflicts;
  if (rawEvent._merged) clean._merged = rawEvent._merged;
  if (rawEvent._parserConfig) clean._parserConfig = rawEvent._parserConfig;
  if (rawEvent._fieldMergeStrategies) clean._fieldMergeStrategies = rawEvent._fieldMergeStrategies;
  
  return clean;
}

/**
 * Parse coordinate string into lat/lng object
 */
function parseCoordinates(coordString) {
  if (!coordString) return { lat: '', lng: '' };
  
  const match = coordString.toString().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (match) {
    return {
      lat: match[1],
      lng: match[2]
    };
  }
  
  return { lat: '', lng: '' };
}

/**
 * Process an event with conflict resolution
 */
function processEventWithConflicts(rawEvent) {
  // Clean the event structure
  let event = cleanEventObject(rawEvent);
  
  // If there are conflicts, merge them intelligently
  if (event._conflicts && event._conflicts.length > 0) {
    event = mergeConflictingEvents(event, event._conflicts);
  }
  
  return event;
}

// Export for use in shared-core.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EVENT_STRUCTURE,
    extractTea,
    extractInstagram,
    mergeConflictingEvents,
    cleanEventObject,
    parseCoordinates,
    processEventWithConflicts
  };
}
/**
 * Shared URL parsing utilities
 * Extracted from calendar-core.js to be used by both calendar loader and download scripts
 */

/**
 * Find first unescaped occurrence of a character in text
 * @param {string} text - The text to search in
 * @param {string} char - The character to find
 * @param {number} startIndex - The index to start searching from
 * @returns {number} - The index of the unescaped character, or -1 if not found
 */
function findUnescaped(text, char, startIndex = 0) {
    for (let i = startIndex; i < text.length; i++) {
        if (text[i] === char) {
            // Count preceding backslashes to determine if this character is escaped
            let backslashCount = 0;
            for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) {
                backslashCount++;
            }
            
            // If even number of backslashes (including 0), the character is not escaped
            if (backslashCount % 2 === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Remove escape characters from text
 * @param {string} text - The text to unescape
 * @returns {string} - The unescaped text
 */
function unescapeText(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }
    
    return text
        .replace(/\\:/g, ':')      // Unescape colons (\: -> :)
        .replace(/\\\\/g, '\\');   // Unescape backslashes (\\ -> \)
}

/**
 * Check if a key is valid for metadata (single word, reasonable length)
 * @param {string} key - The key to validate
 * @returns {boolean} - True if the key is valid
 */
function isValidMetadataKey(key) {
    if (!key || typeof key !== 'string') {
        return false;
    }
    
    const trimmedKey = key.trim();
    
    // Must be a single word (no spaces) and reasonable length
    return /^[a-zA-Z][a-zA-Z0-9]*$/.test(trimmedKey) && 
           trimmedKey.length >= 2 && 
           trimmedKey.length <= 20;
}

/**
 * Parse description for key-value pairs, extracting URLs and other metadata
 * @param {string} description - The description text to parse
 * @returns {Object|null} - The parsed data object or null if no valid data found
 */
function parseKeyValueDescription(description) {
    const data = {};
    const keyMap = {
        'bar': 'bar', 'location': 'bar', 'host': 'bar',
        'cover': 'cover', 'cost': 'cover', 'price': 'cover',
        'tea': 'tea', 'info': 'tea', 'description': 'tea',
        'website': 'website', 'instagram': 'instagram', 'facebook': 'facebook',
        'type': 'type', 'eventtype': 'type', 'recurring': 'recurring',
        'gmaps': 'gmaps', 'google maps': 'gmaps',
        'shortname': 'shortName', 'short name': 'shortName', 'short': 'shortName', 'nickname': 'shortName', 'nick name': 'shortName', 'nick': 'shortName',
        'shortername': 'shorterName', 'shorter name': 'shorterName', 'shorter': 'shorterName',
        'image': 'image'
    };

    // Clean up any remaining carriage returns that might interfere with parsing
    const carriageReturnCount = (description.match(/\r/g) || []).length;
    if (carriageReturnCount > 0) {
        console.debug('Removing carriage returns from description', {
            count: carriageReturnCount,
            sampleBefore: description.substring(0, 100).replace(/\r/g, '\\r').replace(/\n/g, '\\n')
        });
    }
    let textBlock = description.replace(/\r/g, '');
    
    // First, handle HTML content - extract URLs from anchor tags and convert to plain text
    if (textBlock.includes("<a href=") || textBlock.includes("<br>")) {
        // Extract URLs from anchor tags before converting to plain text
        const linkMatches = textBlock.match(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi);
        if (linkMatches) {
            linkMatches.forEach(linkMatch => {
                const urlMatch = linkMatch.match(/href=["']([^"']+)["']/);
                if (urlMatch) {
                    const url = urlMatch[1];
                    // Replace the HTML anchor tag with just the URL
                    textBlock = textBlock.replace(linkMatch, url);
                }
            });
        }
        
        // Convert HTML breaks to newlines
        textBlock = textBlock.replace(/<br\s?\/?>(?=\s*\n?)/gi, "\n");
        
        // Remove any remaining HTML tags - use DOM when available, else regex fallback
        if (typeof document !== 'undefined' && document.createElement) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = textBlock;
            textBlock = tempDiv.textContent || tempDiv.innerText || '';
        } else {
            // Basic fallback: strip tags
            textBlock = textBlock.replace(/<[^>]+>/g, '');
        }
    }
    
    // Replace escaped newlines with actual newlines
    textBlock = textBlock.replace(/\\n/g, "\n");
    
    const lines = textBlock.split("\n");
    
    console.debug('Parsing event description', {
        originalLength: description.length,
        processedLength: textBlock.length,
        linesCount: lines.length,
        containsHTML: description.includes('<'),
        extractedLines: lines.slice(0, 3) // Show first 3 lines for debugging
    });
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        // Use escape-aware parsing to find the first unescaped colon
        const colonIndex = findUnescaped(line, ':');
        
        if (colonIndex > 0) {
            // Extract key and value, then unescape them
            const rawKey = line.substring(0, colonIndex).trim();
            const rawValue = line.substring(colonIndex + 1).trim();
            
            const unescapedKey = unescapeText(rawKey);
            const unescapedValue = unescapeText(rawValue);
            
            // Only process if it's a valid metadata key
            if (isValidMetadataKey(unescapedKey)) {
                const key = unescapedKey.toLowerCase();
                const value = unescapedValue;
                const mappedKey = keyMap[key] || key;
                
                // Additional validation for URLs
                if (['website', 'instagram', 'facebook', 'gmaps', 'image'].includes(mappedKey)) {
                    // Ensure we have a valid URL
                    if (value.startsWith('http://') || value.startsWith('https://')) {
                        data[mappedKey] = value;
                        console.debug(`Extracted ${mappedKey} URL: ${value}`);
                    } else {
                        console.warn(`Invalid URL format for ${mappedKey}: ${value}`);
                    }
                } else {
                    data[mappedKey] = value;
                    console.debug(`Extracted metadata: ${mappedKey} = ${value}`);
                }
            } else {
                // Invalid key - this line is not treated as metadata
                console.debug(`Ignored invalid metadata key: "${unescapedKey}" in line: "${line}"`);
            }
        } else {
            // No unescaped colon found - this is not a metadata line
            console.debug(`No unescaped colon found in line: "${line}"`);
        }
    }
    
    console.debug('Description parsing complete', {
        extractedKeys: Object.keys(data),
        hasWebsite: !!data.website,
        hasInstagram: !!data.instagram,
        hasFacebook: !!data.facebook,
        hasGmaps: !!data.gmaps
    });
    
    return Object.keys(data).length > 0 ? data : null;
}

/**
 * Parse iCal content to extract individual events with proper URL parsing
 * @param {string} content - The iCal content
 * @returns {Array} - Array of event objects with parsed URLs
 */
function parseICalEvents(content) {
    const events = [];
    const lines = content.split('\n');
    let currentEvent = null;
    let inEvent = false;
    let currentDescription = '';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.trim() === 'BEGIN:VEVENT') {
            inEvent = true;
            currentEvent = {};
            currentDescription = '';
        } else if (line.trim() === 'END:VEVENT') {
            if (currentEvent) {
                // Parse the accumulated description for URLs and metadata
                if (currentDescription) {
                    const parsedData = parseKeyValueDescription(currentDescription);
                    if (parsedData) {
                        // Merge parsed data into event
                        Object.assign(currentEvent, parsedData);
                    }
                }
                
                events.push(currentEvent);
                currentEvent = null;
                currentDescription = '';
            }
            inEvent = false;
        } else if (inEvent && currentEvent && line.includes(':')) {
            const colonIndex = line.indexOf(':');
            const field = line.substring(0, colonIndex);
            let value = line.substring(colonIndex + 1);
            
            // Handle multi-line values (continuation lines start with space)
            let j = i + 1;
            while (j < lines.length && lines[j].startsWith(' ')) {
                value += lines[j].substring(1); // Remove leading space
                j++;
            }
            
            // Store the field value
            if (field === 'DESCRIPTION') {
                currentDescription = value;
            } else if (field === 'SUMMARY') {
                currentEvent.summary = value;
            } else if (field === 'LOCATION') {
                currentEvent.location = value;
            }
        }
    }
    
    return events;
}

// Export for Node.js (CommonJS)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        findUnescaped,
        unescapeText,
        isValidMetadataKey,
        parseKeyValueDescription,
        parseICalEvents
    };
}

// Export for browser (ES6 modules)
if (typeof window !== 'undefined') {
    window.UrlParser = {
        findUnescaped,
        unescapeText,
        isValidMetadataKey,
        parseKeyValueDescription,
        parseICalEvents
    };
}
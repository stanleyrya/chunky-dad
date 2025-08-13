/**
 * Text Hyphenation Module
 * Provides intelligent soft hyphen insertion for better text breaking
 * Works alongside existing character estimation logic
 */

class TextHyphenation {
    constructor() {
        // Common prefixes in event/venue names
        this.prefixes = [
            'after', 'under', 'over', 'inter', 'super', 'mega', 'ultra', 
            'multi', 'trans', 'pre', 'post', 'mid', 'anti', 'semi'
        ];
        
        // Common suffixes in event/venue names
        this.suffixes = [
            'fest', 'land', 'night', 'party', 'dance', 'week', 'day',
            'house', 'club', 'bar', 'lounge', 'room', 'zone', 'space'
        ];
        
        // Common compound words in bear community events
        this.compounds = [
            'bear', 'leather', 'pride', 'woof', 'boot', 'black',
            'dance', 'night', 'party', 'weekend', 'happy', 'hour'
        ];
    }
    
    /**
     * Insert soft hyphens at intelligent break points
     * @param {string} text - The text to process
     * @param {boolean} isShortName - Whether this is a shortened name (affects hyphenation strategy)
     * @returns {string} Text with soft hyphens inserted
     */
    insertSoftHyphens(text, isShortName = false) {
        if (!text) return text;
        
        // Use the HTML entity for soft hyphen
        const softHyphen = '&shy;';
        
        // For short names, we want to be more aggressive with hyphenation
        // since they're already designed to be compact
        if (isShortName) {
            return this.aggressiveHyphenation(text, softHyphen);
        } else {
            return this.conservativeHyphenation(text, softHyphen);
        }
    }
    
    /**
     * Conservative hyphenation for full names
     * Only adds hyphens at very obvious break points
     */
    conservativeHyphenation(text, softHyphen) {
        let result = text;
        
        // 1. Add soft hyphens between camelCase words
        result = result.replace(/([a-z])([A-Z])/g, `$1${softHyphen}$2`);
        
        // 2. Add soft hyphens between uppercase sequences (MEGAWOOF -> MEGA-WOOF)
        result = result.replace(/([A-Z]{3,})([A-Z][a-z])/g, `$1${softHyphen}$2`);
        
        // 3. Add soft hyphens after numbers
        result = result.replace(/(\d+)([A-Za-z])/g, `$1${softHyphen}$2`);
        
        // 4. Add soft hyphens before numbers (except at start)
        result = result.replace(/([A-Za-z])(\d+)/g, `$1${softHyphen}$2`);
        
        // 5. Handle very long words (12+ characters) - add hyphen in middle
        result = result.replace(/\b(\w{6,})(\w{6,})\b/g, (match, p1, p2) => {
            // Only if the word doesn't already have a soft hyphen
            if (!match.includes(softHyphen)) {
                return `${p1}${softHyphen}${p2}`;
            }
            return match;
        });
        
        return result;
    }
    
    /**
     * Aggressive hyphenation for short names
     * Adds more break points since these names are meant to wrap better
     */
    aggressiveHyphenation(text, softHyphen) {
        let result = text;
        
        // Start with conservative rules
        result = this.conservativeHyphenation(result, softHyphen);
        
        // Additional aggressive rules for short names
        
        // 6. Add soft hyphens after common prefixes (case-insensitive)
        this.prefixes.forEach(prefix => {
            const regex = new RegExp(`\\b(${prefix})([A-Z])`, 'gi');
            result = result.replace(regex, `$1${softHyphen}$2`);
        });
        
        // 7. Add soft hyphens before common suffixes
        this.suffixes.forEach(suffix => {
            const regex = new RegExp(`([a-z])(${suffix})\\b`, 'gi');
            result = result.replace(regex, `$1${softHyphen}$2`);
        });
        
        // 8. Break up all-caps sequences at logical points (every 4-5 chars)
        result = result.replace(/\b([A-Z]{4,5})([A-Z]{3,})\b/g, `$1${softHyphen}$2`);
        
        // 9. Add soft hyphens between repeated words (WOOFWOOF -> WOOF-WOOF)
        this.compounds.forEach(word => {
            const regex = new RegExp(`(${word})(${word})`, 'gi');
            result = result.replace(regex, `$1${softHyphen}$2`);
        });
        
        // 10. Handle compound bear community terms
        result = result.replace(/(bear|leather|woof|pride|boot|dance)([A-Z])/gi, `$1${softHyphen}$2`);
        result = result.replace(/([a-z])(bear|leather|woof|pride|boot|dance)/gi, `$1${softHyphen}$2`);
        
        return result;
    }
    
    /**
     * Process venue/bar names with soft hyphens
     * Venue names typically need less aggressive hyphenation
     */
    processVenueName(venueName) {
        if (!venueName) return venueName;
        
        // Use conservative hyphenation for venue names
        // They're usually shorter and don't need as many break points
        return this.conservativeHyphenation(venueName, '&shy;');
    }
    
    /**
     * Determine if a text would benefit from soft hyphens
     * @param {string} text - The text to analyze
     * @param {number} containerWidth - Approximate container width in characters
     * @returns {boolean} Whether soft hyphens would help
     */
    shouldUseSoftHyphens(text, containerWidth) {
        if (!text) return false;
        
        // Check if any word is longer than container width
        const words = text.split(/\s+/);
        const hasLongWords = words.some(word => word.length > containerWidth * 0.8);
        
        // Check if text has compound words that could benefit
        const hasCompounds = /[a-z][A-Z]|[A-Z]{4,}|[a-zA-Z]{10,}/.test(text);
        
        return hasLongWords || hasCompounds;
    }
    
    /**
     * Remove soft hyphens from text (for comparison or display)
     */
    removeSoftHyphens(text) {
        if (!text) return text;
        // Remove all forms of soft hyphens
        return text.replace(/&shy;|&#173;|&#xad;|\u00AD/g, '');
    }
    
    /**
     * Count visible characters (excluding soft hyphens)
     */
    countVisibleChars(text) {
        return this.removeSoftHyphens(text).length;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TextHyphenation;
}

// Create global instance for browser use
if (typeof window !== 'undefined') {
    window.TextHyphenation = TextHyphenation;
    window.textHyphenation = new TextHyphenation();
    
    // Log initialization
    if (window.logger) {
        window.logger.componentInit('HYPHEN', 'Text hyphenation module initialized');
    }
}
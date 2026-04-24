// ============================================================================
// EVENT SCHEMA - SHARED EVENT FIELD CANONICALIZATION + NOTES CODEC
// ============================================================================
// Pure JavaScript helpers shared by website + Scriptable runtimes.
//
// IMPORTANT: This file exists in two locations that must be kept in sync:
//   - scripts/event-schema.js  (used by Scriptable and test-unified-scraper.html)
//   - js/event-schema.js       (used by event-builder.html and the website)
// When making changes, update BOTH files.

const EVENT_KEY_ALIASES = {
    title: 'title',
    name: 'title',
    summary: 'title',
    eventname: 'title',

    description: 'description',
    desc: 'description',
    details: 'description',
    tea: 'description',
    info: 'description',

    venue: 'bar',
    savedbar: 'bar',
    locationname: 'bar',
    host: 'bar',
    bar: 'bar',

    address: 'address',
    addr: 'address',
    loc: 'location',
    coords: 'location',
    coordinates: 'location',

    city: 'city',
    timezone: 'timezone',
    timezoneid: 'timezone',
    tz: 'timezone',

    startdate: 'startDate',
    start: 'startDate',
    starttime: 'startTime',
    date: 'date',
    eventdate: 'date',
    enddate: 'endDate',
    end: 'endDate',
    endtime: 'endTime',

    recurrence: 'recurrence',
    rrule: 'recurrence',
    type: 'type',
    eventtype: 'type',
    recurrenceid: 'recurrenceId',
    recurrencetimezone: 'recurrenceIdTimezone',
    recurrencetz: 'recurrenceIdTimezone',
    sequence: 'sequence',
    seq: 'sequence',

    overrideuid: 'overrideUid',
    overriderecurrenceid: 'overrideRecurrenceId',

    website: 'website',
    web: 'website',
    site: 'website',
    url: 'website',
    link: 'website',
    eventurl: 'website',
    eventlink: 'website',
    ticketurl: 'ticketUrl',
    ticketlink: 'ticketUrl',
    ticket: 'ticketUrl',
    tickets: 'ticketUrl',
    instagram: 'instagram',
    insta: 'instagram',
    ig: 'instagram',
    facebook: 'facebook',
    fb: 'facebook',
    twitter: 'twitter',
    xtwitter: 'twitter',
    x: 'twitter',
    gmaps: 'gmaps',
    googlemaps: 'gmaps',
    googlemapslink: 'gmaps',
    map: 'gmaps',

    image: 'image',
    photo: 'image',
    cover: 'cover',

    shortname: 'shortName',
    short: 'shortName',
    shorttitle: 'shortName',
    nickname: 'shortName',
    shortername: 'shorterName',
    shorter: 'shorterName',

    key: 'key',
    matchkey: 'matchKey',
    identifier: 'identifier',
    id: 'identifier',

    searchstartdate: 'searchStartDate',
    searchenddate: 'searchEndDate',
    durationminutes: 'durationMinutes',
    durationmins: 'durationMinutes',
    durationmin: 'durationMinutes',
    durationhours: 'durationHours',
    duration: 'durationMinutes',

    latitude: 'lat',
    lat: 'lat',
    longitude: 'lng',
    lng: 'lng'
};

const URL_LIKE_FIELDS = new Set([
    'url',
    'ticketUrl',
    'gmaps',
    'website',
    'facebook',
    'instagram',
    'twitter',
    'image'
]);

const DEFAULT_NOTES_EXCLUDED_FIELDS = new Set([
    'title', 'startDate', 'endDate', 'location', 'coordinates', 'notes',
    'url', 'website',
    'isBearEvent', 'source', 'city', 'setDescription', '_analysis', '_action',
    '_existingEvent', '_existingKey', '_conflicts', '_parserConfig', '_fieldPriorities',
    '_original', '_mergeInfo', '_changes', '_mergeDiff',
    'originalTitle', 'name',
    'recurrenceId', 'recurrenceIdTimezone', 'sequence',
    'lat', 'lng',
    'placeId',
    'timezone',
    'matchKey',
    'links', 'durationMinutes',
    'time', 'day', 'recurring', 'recurrence',
    'isDeletingOverride'
]);

const EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY = Object.freeze({
    title: 'name',
    shortName: 'shortName',
    city: 'city',
    venue: 'venue',
    bar: 'savedBar',
    address: 'address',
    location: 'location',
    description: 'description',
    cover: 'cover',
    startDate: 'start',
    endDate: 'end',
    timezone: 'timezone',
    recurrence: 'recurrence',
    website: 'website',
    ticketUrl: 'ticketUrl',
    instagram: 'instagram',
    facebook: 'facebook',
    gmaps: 'gmaps',
    image: 'image'
});

const EVENT_BUILDER_STATE_LABELS = Object.freeze({
    name: 'Name',
    shortName: 'Short name',
    city: 'City',
    venue: 'Venue',
    address: 'Address',
    location: 'Coordinates',
    description: 'Description',
    cover: 'Cover',
    start: 'Start',
    end: 'End',
    recurrence: 'Recurrence',
    website: 'Website',
    ticketUrl: 'Tickets',
    instagram: 'Instagram',
    facebook: 'Facebook',
    gmaps: 'Google Maps',
    image: 'Image'
});

function normalizeAliasKey(key) {
    return String(key || '').toLowerCase().replace(/[\s\-_]/g, '');
}

function canonicalizeEventKey(key, options = {}) {
    if (!key && key !== 0) return key;
    const normalized = normalizeAliasKey(key);
    const context = options && options.context ? options.context : 'event';
    if (context === 'notes' && normalized === 'location') {
        return 'bar';
    }
    if (Object.prototype.hasOwnProperty.call(EVENT_KEY_ALIASES, normalized)) {
        return EVENT_KEY_ALIASES[normalized];
    }
    return key;
}

function findUnescaped(text, char, startIndex = 0) {
    if (!text || !char) return -1;
    for (let i = startIndex; i < text.length; i += 1) {
        if (text[i] === char) {
            let backslashCount = 0;
            let j = i - 1;
            while (j >= 0 && text[j] === '\\') {
                backslashCount += 1;
                j -= 1;
            }
            if (backslashCount % 2 === 0) {
                return i;
            }
        }
    }
    return -1;
}

function unescapeText(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/\\:/g, ':')
        .replace(/\\\\/g, '\\');
}

function escapeText(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:');
}

function isValidMetadataKey(key) {
    if (!key || typeof key !== 'string') return false;
    const trimmed = key.trim();
    return /^[a-zA-Z][a-zA-Z0-9\s]*[a-zA-Z0-9]$/.test(trimmed) &&
        trimmed.length >= 2 &&
        trimmed.length <= 30;
}

function isUrlLikeField(fieldName, valueString) {
    if (URL_LIKE_FIELDS.has(fieldName)) return true;
    if (!valueString || typeof valueString !== 'string') return false;
    const lower = valueString.trim().toLowerCase();
    return lower.startsWith('http://') ||
        lower.startsWith('https://') ||
        lower.startsWith('mailto:') ||
        lower.startsWith('tel:') ||
        lower.startsWith('sms:');
}

function normalizeHtmlNotes(notes) {
    if (!notes || typeof notes !== 'string') return notes;
    if (!/<|&nbsp;|&amp;|&lt;|&gt;|&quot;/i.test(notes)) return notes;

    let text = notes;
    // Extract URLs from anchor tags that have an href attribute
    text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, '$1');
    // Strip remaining anchor tags but keep their text content
    text = text.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1');
    // Replace <br> variants with newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    // Strip remaining HTML tags (run twice to handle self-closing or malformed tags)
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/<[^>]+>/g, '');
    // Remove any remaining lone angle brackets from malformed HTML
    text = text.replace(/</g, '').replace(/>/g, '');
    // Decode common HTML entities (&amp; last to avoid double-unescaping)
    text = text.replace(/&nbsp;/gi, ' ');
    text = text.replace(/&lt;/gi, '<');
    text = text.replace(/&gt;/gi, '>');
    text = text.replace(/&quot;/gi, '"');
    text = text.replace(/&#39;/gi, "'");
    text = text.replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        return (code >= 0 && code <= 0x10FFFF) ? String.fromCodePoint(code) : '';
    });
    text = text.replace(/&amp;/gi, '&');
    // Trim trailing whitespace on each line
    text = text.split('\n').map(line => line.trimEnd()).join('\n');
    return text;
}

function parseNotesIntoFields(notes) {
    const fields = {};
    if (!notes || typeof notes !== 'string') return fields;

    const normalizedNotes = normalizeHtmlNotes(notes);
    const lines = normalizedNotes.split('\n');
    let currentKey = null;
    let currentValue = '';

    lines.forEach((line, index) => {
        const colonIndex = findUnescaped(line, ':');
        if (colonIndex > 0) {
            if (currentKey && currentValue !== '') {
                const canonicalKey = canonicalizeEventKey(currentKey, { context: 'notes' });
                fields[canonicalKey] = unescapeText(currentValue);
            }

            const rawKey = line.substring(0, colonIndex).trim();
            const rawValue = line.substring(colonIndex + 1).trim();
            const unescapedKey = unescapeText(rawKey);
            const unescapedValue = unescapeText(rawValue);

            if (unescapedKey && isValidMetadataKey(unescapedKey)) {
                currentKey = unescapedKey;
                currentValue = unescapedValue;
            } else {
                if (currentKey && line.trim()) {
                    currentValue = currentValue
                        ? `${currentValue}\n${unescapeText(line)}`
                        : unescapeText(line);
                }
            }
        } else if (currentKey && line.trim()) {
            const unescapedLine = unescapeText(line);
            currentValue = currentValue
                ? `${currentValue}\n${unescapedLine}`
                : unescapedLine;
        }

        if (index === lines.length - 1 && currentKey && currentValue !== '') {
            const canonicalKey = canonicalizeEventKey(currentKey, { context: 'notes' });
            fields[canonicalKey] = unescapeText(currentValue);
        }
    });

    return fields;
}

function formatEventNotes(event, options = {}) {
    if (!event || typeof event !== 'object') return '';
    const excludeFields = options.excludeFields instanceof Set
        ? options.excludeFields
        : DEFAULT_NOTES_EXCLUDED_FIELDS;
    const notes = [];

    Object.keys(event).forEach(fieldName => {
        if (excludeFields.has(fieldName)) return;
        const value = event[fieldName];
        if (value === undefined || value === null || value === '') return;
        const valueString = String(value);
        const valueForNotes = isUrlLikeField(fieldName, valueString)
            ? valueString
            : escapeText(valueString);
        notes.push(`${fieldName}: ${valueForNotes}`);
    });

    return notes.join('\n');
}

function getEventBuilderStateKey(paramKey) {
    if (paramKey === null || paramKey === undefined) {
        return null;
    }
    const normalized = normalizeAliasKey(paramKey);
    // Check the normalized raw param key first, before alias expansion. This lets
    // builder URL params like 'venue' (display text field → state.venue) take
    // precedence over the event-data alias chain (venue → bar → savedBar).
    if (Object.prototype.hasOwnProperty.call(EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY, normalized)) {
        return EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY[normalized];
    }
    const canonicalKey = canonicalizeEventKey(paramKey);
    return Object.prototype.hasOwnProperty.call(EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY, canonicalKey)
        ? EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY[canonicalKey]
        : null;
}

const EventSchema = {
    EVENT_KEY_ALIASES,
    URL_LIKE_FIELDS,
    DEFAULT_NOTES_EXCLUDED_FIELDS,
    EVENT_PARAM_MAP: EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY,
    EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY,
    EVENT_BUILDER_STATE_LABELS,
    normalizeAliasKey,
    canonicalizeEventKey,
    findUnescaped,
    unescapeText,
    escapeText,
    isValidMetadataKey,
    isUrlLikeField,
    parseNotesIntoFields,
    formatEventNotes,
    getEventBuilderStateKey
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EventSchema };
    if (typeof globalThis !== 'undefined') {
        globalThis.EventSchema = EventSchema;
    }
} else if (typeof window !== 'undefined') {
    window.EventSchema = EventSchema;
} else {
    this.EventSchema = EventSchema;
}

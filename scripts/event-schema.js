// ============================================================================
// EVENT SCHEMA - SHARED EVENT FIELD CANONICALIZATION + NOTES CODEC
// ============================================================================
// Pure JavaScript helpers shared by website + Scriptable runtimes.

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
    locationname: 'bar',
    host: 'bar',
    bar: 'bar',

    address: 'address',
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
    url: 'url',
    link: 'url',
    eventurl: 'url',
    eventlink: 'url',
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
    'isBearEvent', 'source', 'city', 'setDescription', '_analysis', '_action',
    '_existingEvent', '_existingKey', '_conflicts', '_parserConfig', '_fieldPriorities',
    '_original', '_mergeInfo', '_changes', '_mergeDiff',
    'originalTitle', 'name',
    'identifier', 'availability', 'timeZone', 'calendar', 'addRecurrenceRule',
    'removeAllRecurrenceRules', 'save', 'remove', 'presentEdit', '_staticFields',
    'recurrenceId', 'recurrenceIdTimezone', 'sequence',
    'searchStartDate', 'searchEndDate',
    'lat', 'lng',
    'placeId',
    'timezone',
    'matchKey',
    'links', 'durationMinutes',
    'time', 'day', 'recurring', 'recurrence',
    'isDeletingOverride'
]);

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

function parseNotesIntoFields(notes) {
    const fields = {};
    if (!notes || typeof notes !== 'string') return fields;

    const lines = notes.split('\n');
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

const EventSchema = {
    EVENT_KEY_ALIASES,
    URL_LIKE_FIELDS,
    DEFAULT_NOTES_EXCLUDED_FIELDS,
    normalizeAliasKey,
    canonicalizeEventKey,
    findUnescaped,
    unescapeText,
    escapeText,
    isValidMetadataKey,
    isUrlLikeField,
    parseNotesIntoFields,
    formatEventNotes
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

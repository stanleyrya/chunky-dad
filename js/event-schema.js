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

    startdate: 'startDate',
    starttime: 'startTime',
    date: 'date',
    eventdate: 'date',
    enddate: 'endDate',
    endtime: 'endTime',
    startDate: 'startDate',
    startTime: 'startTime',
    endDate: 'endDate',
    endTime: 'endTime',
    start: 'start',
    end: 'end',

    recurrence: 'recurrence',
    rrule: 'recurrence',
    recurrencerule: 'recurrence',
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
    favicon: 'favicon',
    img: 'image',
    photo: 'image',
    // Multi-orientation image slots. normalizeAliasKey lowercases and strips
    // spaces/hyphens/underscores, so the single 'imagevertical' entry also
    // resolves 'imageVertical', 'Image Vertical', 'image-vertical' and
    // 'image_vertical' as INPUT spellings (URL params, foreign notes). Only
    // the camelCase canonical form is ever WRITTEN to notes: isValidMetadataKey
    // permits letters/digits/spaces only, so a hyphenated or underscored key
    // silently vanishes from the notes with no error.
    imagevertical: 'imageVertical',
    verticalimage: 'imageVertical',
    imageportrait: 'imageVertical',
    portraitimage: 'imageVertical',
    imgvertical: 'imageVertical',
    imagehorizontal: 'imageHorizontal',
    horizontalimage: 'imageHorizontal',
    imagelandscape: 'imageHorizontal',
    landscapeimage: 'imageHorizontal',
    imghorizontal: 'imageHorizontal',
    cover: 'cover',
    bearreview: 'bearReview',

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
    'image',
    'imageVertical',
    'imageHorizontal',
    'favicon'
]);

const DEFAULT_NOTES_EXCLUDED_FIELDS = new Set([
    'title', 'startDate', 'endDate', 'location', 'coordinates', 'notes',
    'url',
    'isBearEvent', 'source', 'city', 'setDescription', '_analysis', '_action',
    '_existingEvent', '_existingKey', '_conflicts', '_parserConfig', '_fieldPriorities',
    '_original', '_mergeInfo', '_changes', '_mergeDiff', '_staticFields',
    'originalTitle', 'name',
    'recurrenceId', 'recurrenceIdTimezone', 'sequence',
    'lat', 'lng',
    'placeId',
    'matchKey',
    'links', 'durationMinutes',
    'time', 'day', 'recurring', 'recurrence', 'recurrenceRule',
    'isDeletingOverride'
]);

const EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY = Object.freeze({
    title: 'name',
    shortName: 'shortName',
    city: 'city',
    // The event's zone, so a prefill is interpreted in the EVENT's timezone
    // rather than the device's (see scriptable-adapter buildEventBuilderUrl).
    timezone: 'timezone',
    venue: 'venue',
    bar: 'savedBar',
    address: 'address',
    location: 'location',
    description: 'description',
    cover: 'cover',
    startDate: 'start',
    endDate: 'end',
    recurrence: 'recurrence',
    website: 'website',
    ticketUrl: 'ticketUrl',
    instagram: 'instagram',
    facebook: 'facebook',
    gmaps: 'gmaps',
    image: 'image',
    imageVertical: 'imageVertical',
    imageHorizontal: 'imageHorizontal',
    favicon: 'favicon'
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
        if (String(fieldName).startsWith('_')) return;
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

// Trimmed string value of one image slot, or '' when absent/blank.
function readImageSlotValue(event, fieldName) {
    const value = event ? event[fieldName] : null;
    return typeof value === 'string' ? value.trim() : '';
}

// The identity of the STORED FILE an image URL points at: host + path, with the
// query string, the fragment and the scheme dropped. Two URLs that share this
// key are the same picture served with different delivery parameters (imgix /
// Cloudinary / thumbor style crop + resize), not two different pictures.
//
// String parsing on purpose: no `new URL(` / `URLSearchParams` — the Scriptable
// runtime that runs scripts/event-schema.js — this file's twin — has neither.
function imageAssetKey(url) {
    const raw = typeof url === 'string' ? url.trim() : '';
    if (!raw) return '';
    const withoutQuery = raw.split('#')[0].split('?')[0];
    if (!withoutQuery) return '';
    // "https://host/path", "//host/path" — anything else (root-relative,
    // downloaded flyers) has no host and compares verbatim.
    const authorityMatch = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.exec(withoutQuery);
    if (!authorityMatch) return withoutQuery;
    const rest = withoutQuery.slice(authorityMatch[0].length);
    const slash = rest.indexOf('/');
    const host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
    const path = slash < 0 ? '' : rest.slice(slash);
    // Scheme is deliberately ignored: http and https of one file are one file.
    return `${host}${path}`;
}

// True when two image URLs resolve to the same stored asset and differ only in
// their delivery query (crop/resize/format). See pickImageForOrientation.
function isSameImageAsset(a, b) {
    const keyA = imageAssetKey(a);
    if (!keyA) return false;
    return keyA === imageAssetKey(b);
}

// Pick the best image for a wanted orientation from the three slots.
//   want: 'portrait' | 'vertical' | 'landscape' | 'horizontal' (anything else
//         means "no preference" and returns the primary).
// Fallback chain, in order:
//   0. …unless the exact-orientation slot is the SAME STORED ASSET as the
//      primary with a different crop query (isSameImageAsset). A "horizontal"
//      variant of the picture we already have is not a wider picture — it is
//      this picture with its top and bottom cut off (dice.fm ships a 768×768
//      flyer as `image` and a rect=0,154,768,461 imgix crop of that same file
//      as `imageHorizontal`, discarding 40% of the artwork). In that case the
//      uncropped primary wins. A genuinely SEPARATE wide image — different
//      host or path — still wins, which is the whole point of the slot.
//   1. the exact-orientation slot (imageVertical / imageHorizontal)
//   2. the primary `image` when it classifies as the wanted orientation
//   3. the primary `image` when its orientation is UNKNOWN — by far the common
//      case, and the reason this degrades to today's single-image behavior
//   4. the other slot
//   5. the primary `image`
// Never returns null/undefined when the event carries any image; returns ''
// only when it carries none.
//
// Classification is INJECTED, not imported: this file is pure and standalone
// (the website loads it without shared-core). Pass
// options.classifyOrientation — on the scraper side that is
// sharedCore.classifyImageOrientation bound to the core instance. Without it
// every primary reads as 'unknown', which collapses steps 2/3 into "return the
// primary" — a safe, slot-driven result, since the parsers populate the slots.
function pickImageForOrientation(event, want, options = {}) {
    if (!event || typeof event !== 'object') return '';
    const primary = readImageSlotValue(event, 'image');
    const vertical = readImageSlotValue(event, 'imageVertical');
    const horizontal = readImageSlotValue(event, 'imageHorizontal');
    const wanted = String(want || '').trim().toLowerCase();
    const wantsPortrait = wanted === 'portrait' || wanted === 'vertical';
    const wantsLandscape = wanted === 'landscape' || wanted === 'horizontal';
    if (!wantsPortrait && !wantsLandscape) {
        return primary || vertical || horizontal || '';
    }

    const exactSlot = wantsPortrait ? vertical : horizontal;
    // Same file, different crop → the slot is a degraded copy of the primary,
    // so the primary wins (isSameImageAsset is false whenever there is no
    // primary to fall back to, which keeps the slot-only event answering).
    if (exactSlot) return isSameImageAsset(exactSlot, primary) ? primary : exactSlot;

    const otherSlot = wantsPortrait ? horizontal : vertical;
    if (primary) {
        let orientation = 'unknown';
        if (typeof options.classifyOrientation === 'function') {
            try {
                orientation = String(options.classifyOrientation(primary) || 'unknown');
            } catch (error) {
                orientation = 'unknown';
            }
        }
        if (orientation === 'unknown') return primary;
        if (orientation === (wantsPortrait ? 'portrait' : 'landscape')) return primary;
    }
    // Same rule on the way out: a crop of the primary is never an upgrade.
    if (otherSlot && !isSameImageAsset(otherSlot, primary)) return otherSlot;
    return primary || otherSlot || '';
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

const AI_PROMPT_FIELDS = [
    { param: 'name',    desc: 'The formal title of the event as stated.' },
    { param: 'short',   desc: 'If the title is long, a shorter version to display as a reference. For long words, add - to help break them up). It will not show unless we need two lines. If you want a hyphen all the time, add \\- instead. The \\ will not show.' },
    { param: 'desc',    desc: 'Event description/tagline from source text; do not invent details.' },
    { param: 'city',    desc: 'City name (e.g. "new york", "los angeles"). Return lowercase city name only.' },
    { param: 'venue',   desc: 'Venue or bar name exactly as stated. Do not infer using address or coordinates.' },
    { param: 'addr',    desc: 'Street address exactly as shown. Do not infer using coordinates, bar/venue name, or other data.' },
    { param: 'coords',  desc: 'Coordinates if they are explicitly stored in the page on its own in the format "lat,lng", not using the address or bar/venue' },
    { param: 'startDate', desc: 'Start date only. Use YYYY-MM-DD format. If the source shows "May 12, 2026" or similar, convert to YYYY-MM-DD.' },
    { param: 'startTime', desc: 'Start time only. Use HH:MM 24-hour format (e.g. "22:30" for 10:30pm, "03:00" for 3am). Handle formats like "01H", "10PM", "3:30 AM", etc.' },
    { param: 'endDate', desc: 'End date only. Use YYYY-MM-DD format. If the source shows "May 12, 2026" or similar, convert to YYYY-MM-DD.' },
    { param: 'endTime', desc: 'End time only. Use HH:MM 24-hour format (e.g. "22:30" for 10:30pm, "03:00" for 3am). Handle formats like "01H", "10PM", "3:30 AM", etc.' },
    { param: 'start',   desc: 'Start datetime. Use YYYY-MM-DDTHH:MM for local time. If the source explicitly includes a UTC offset or Z suffix, preserve it (e.g. YYYY-MM-DDTHH:MM-05:00 or YYYY-MM-DDTHH:MMZ).' },
    { param: 'end',     desc: 'End datetime. Use YYYY-MM-DDTHH:MM for local time. If the source explicitly includes a UTC offset or Z suffix, preserve it (e.g. YYYY-MM-DDTHH:MM-05:00 or YYYY-MM-DDTHH:MMZ).' },
    { param: 'rrule',   desc: 'Valid iCal RRULE value (e.g. FREQ=WEEKLY;BYDAY=FR) ONLY when an explicit repeat schedule is stated; never infer from vague words like "returns" or "back", and never return natural-language/date-range text' },
    { param: 'web',     desc: 'Event or organizer website URL from page metadata/content.' },
    { param: 'tickets', desc: 'Ticket purchase URL only when explicitly present' },
    { param: 'insta',   desc: 'Instagram handle (e.g. @bearracuda) or full Instagram URL' },
    { param: 'fb',      desc: 'Facebook event or page URL' },
    { param: 'gmaps',   desc: 'Google Maps link' },
    { param: 'img',     desc: 'The promotional image URL exactly as shown.' },
    { param: 'cover',   desc: 'Exact offer/cover/admission/ticket price text from source. Capture all listed admission prices (e.g. "$20, $30" or "$20-$30" for min/max ranges), omit if not stated. Do not include "FREE" unless explicitly in source text.' }
];

const AI_FIELD_SIGNAL_REGEXES = {
    name: [
        '\\bname\\b',
        '\\btitle\\b',
        '\\bheadline\\b'
    ],
    short: [
        '\\bshort(?:\\s*title|\\s*name)?\\b',
        '\\bsubtitle\\b',
        '\\bteaser\\b'
    ],
    desc: [
        '\\bdescription\\b',
        '\\bsummary\\b',
        '\\bdetails?\\b',
        '\\babout\\b'
    ],
    city: [
        '\\bcity\\b',
        '\\baddress(?:_|\\s|-)?locality\\b',
        '\\blocality\\b'
    ],
    venue: [
        '\\bvenue\\b',
        '\\blocation\\b',
        '\\bplace\\b'
    ],
    addr: [
        '\\baddress\\b',
        '\\bstreet(?:_|\\s|-)?address\\b',
        '\\baddress(?:_|\\s|-)?line\\b'
    ],
    coords: [
        '\\bcoordinates?\\b',
        '\\bgeo\\b',
        '\\blat(?:itude)?\\b',
        '\\blng\\b',
        '\\blon(?:gitude)?\\b'
    ],
    start: [
        '\\bstart(?:_|\\s|-)?date\\b',
        '\\bstart(?:_|\\s|-)?time\\b',
        '\\bstart(?:_|\\s|-)?datetime\\b',
        '\\bstart\\b',
        '\\bdoor(?:_|\\s|-)?time\\b',
        '\\bdatetime\\b'
    ],
    startDate: [
        '\\bstart(?:_|\\s|-)?date\\b',
        '\\bdate\\b'
    ],
    startTime: [
        '\\bstart(?:_|\\s|-)?time\\b',
        '\\btime\\b'
    ],
    end: [
        '\\bend(?:_|\\s|-)?date\\b',
        '\\bend(?:_|\\s|-)?time\\b',
        '\\bend(?:_|\\s|-)?datetime\\b',
        '\\bend\\b'
    ],
    endDate: [
        '\\bend(?:_|\\s|-)?date\\b'
    ],
    endTime: [
        '\\bend(?:_|\\s|-)?time\\b',
        '\\btime\\b'
    ],
    rrule: [
        '\\brrule\\b',
        '\\brecurr(?:ence|ing)?\\b',
        '\\bfreq\\b',
        '\\bbyday\\b'
    ],
    web: [
        '\\burl\\b',
        '\\bwebsite\\b',
        '\\bcanonical\\b'
    ],
    tickets: [
        '\\btickets?\\b',
        '\\bticket(?:_|\\s|-)?url\\b',
        '\\bbooking\\b',
        '\\breserve\\b'
    ],
    insta: [
        '\\binstagram\\b',
        '\\binsta\\b'
    ],
    fb: [
        '\\bfacebook\\b',
        '\\bfb\\b'
    ],
    gmaps: [
        '\\bgoogle\\s*maps?\\b',
        '\\bgmaps?\\b',
        '\\bmaps?\\.google\\b'
    ],
    img: [
        '\\bimage\\b',
        '\\bthumbnail\\b',
        '\\bphoto\\b',
        '\\bog:image\\b',
        '\\btwitter:image\\b'
    ],
    cover: [
        '\\boffers?\\b',
        '\\bprice\\b',
        '\\bprice(?:_|\\s|-)?currency(?=\\W|$)',
        '\\blow\\s*price\\b',
        '\\bhigh\\s*price\\b',
        '\\bcover\\b',
        '\\badmission\\b',
        '\\btickets?\\b'
    ]
};

// ============================================================================
// RECURRING-EVENT ICS EXPORT (pure helpers)
// ============================================================================
// The scraper NEVER writes or mutates recurring series in the calendar.
// Detected series are surfaced in the results UI and exported as an .ics the
// owner imports manually — these helpers build that ICS. Conventions mirror
// testing/event-builder.html generateICS (UID shape, TZID local wall-clock
// datetimes, PRODID), plus RFC 5545 75-octet line folding.

function escapeIcsText(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

// RFC 5545 §3.1: content lines SHOULD NOT exceed 75 octets (excluding CRLF);
// longer lines fold onto continuation lines that begin with a single space.
// Counts UTF-8 octets and never splits inside a code point.
function foldIcsLine(line) {
    const text = String(line);
    const octetsOf = (codePoint) => {
        if (codePoint <= 0x7f) return 1;
        if (codePoint <= 0x7ff) return 2;
        if (codePoint <= 0xffff) return 3;
        return 4;
    };
    const folded = [];
    let current = '';
    let currentOctets = 0;
    for (const char of text) {
        const octets = octetsOf(char.codePointAt(0));
        if (currentOctets + octets > 75) {
            folded.push(current);
            current = ' ';
            currentOctets = 1;
        }
        current += char;
        currentOctets += octets;
    }
    folded.push(current);
    return folded.join('\r\n');
}

function formatIcsDateUtc(date) {
    const parsed = date instanceof Date ? date : new Date(date);
    if (isNaN(parsed.getTime())) return '';
    return parsed.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// Local wall-clock YYYYMMDDTHHMMSS in an IANA timezone (no trailing Z) —
// paired with ;TZID= on DTSTART/DTEND. Returns '' when the timezone cannot
// be resolved so callers can fall back to UTC-Z values.
function formatIcsDateInTimezone(date, timezone) {
    const parsed = date instanceof Date ? date : new Date(date);
    if (isNaN(parsed.getTime()) || !timezone) return '';
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).formatToParts(parsed);
        const values = {};
        parts.forEach(part => {
            if (part.type !== 'literal') {
                values[part.type] = part.value;
            }
        });
        if (!values.year || !values.month || !values.day) return '';
        const hour = values.hour === '24' ? '00' : (values.hour || '00');
        const minute = values.minute || '00';
        const second = values.second || '00';
        return `${values.year}${values.month}${values.day}T${hour}${minute}${second}`;
    } catch (error) {
        return '';
    }
}

// Same slug rules as the event-builder UID slug (testing/event-builder.html).
function slugifyIcsText(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

// Build a complete VCALENDAR/VEVENT for one recurring event. DESCRIPTION is
// the event's standard notes (EventSchema.formatEventNotes) PLUS an explicit
// `recurrence: <rrule>` line — the notes key the merge machinery reads as a
// series-detection signal once the owner has imported the ICS. (The default
// notes-exclusion list applies to scraper CALENDAR writes; this ICS is the
// deliberate, owner-driven channel, so the line is appended explicitly.)
// options: { timezone, now } — now is injectable for deterministic tests.
function buildRecurringEventIcs(event, options = {}) {
    if (!event || typeof event !== 'object') return '';
    const rrule = String(event.recurrenceRule || event.recurrence || '')
        .replace(/^RRULE\s*:/i, '')
        .trim();
    const title = String(event.title || event.name || '').trim() || 'chunky-dad';
    const timezone = String(options.timezone || event.timezone || '').trim();
    const now = options.now instanceof Date ? options.now : new Date();

    // UID matches the event-builder style: <slug>-<utcstamp>@chunky.dad
    // (e.g. fuzzy-20260503T203532Z@chunky.dad).
    const uid = `${slugifyIcsText(title) || 'chunky-dad'}-${formatIcsDateUtc(now)}@chunky.dad`;

    const dateProperty = (name, date) => {
        const local = timezone ? formatIcsDateInTimezone(date, timezone) : '';
        if (local) return `${name};TZID=${timezone}:${local}`;
        const utc = formatIcsDateUtc(date);
        return utc ? `${name}:${utc}` : '';
    };

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//chunky.dad//Event Builder//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${formatIcsDateUtc(now)}`
    ];
    const dtStart = dateProperty('DTSTART', event.startDate);
    if (dtStart) lines.push(dtStart);
    const dtEnd = event.endDate ? dateProperty('DTEND', event.endDate) : '';
    if (dtEnd) lines.push(dtEnd);
    lines.push(`SUMMARY:${escapeIcsText(title)}`);

    const notes = formatEventNotes(event);
    const descriptionText = rrule
        ? `${notes ? `${notes}\n` : ''}recurrence: ${escapeText(rrule)}`
        : notes;
    if (descriptionText) {
        lines.push(`DESCRIPTION:${escapeIcsText(descriptionText)}`);
    }
    const website = String(event.website || event.url || '').trim();
    if (website) {
        lines.push(`URL:${escapeIcsText(website)}`);
    }
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:OPAQUE');
    if (rrule) {
        lines.push(`RRULE:${rrule}`);
    }
    const location = String(event.location || '').trim();
    if (location) {
        lines.push(`LOCATION:${escapeIcsText(location)}`);
    }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(foldIcsLine).join('\r\n');
}

// Deterministic next-occurrence date for the practical RRULE subset a
// recurring-but-dateless event needs to survive normalization (run
// 20260728-113040: The Lumberyard's events are recurring with no printed
// date — without a derived startDate the required-field guard discarded
// them all). Supported forms:
//   - FREQ=DAILY (no BYDAY filter)
//   - FREQ=WEEKLY with BYDAY of one or more plain weekday codes → nearest
//   - FREQ=MONTHLY with a single ordinal BYDAY (1FR..5SU, -1 for last)
// Anything else — unknown FREQ, INTERVAL>1 (no DTSTART anchor to phase it),
// missing/ordinal-free BYDAY where required — returns null and the caller
// keeps today's discard behavior. Pure local-calendar date math on the
// injected `fromDate` (today counts as an occurrence); returns a local
// YYYY-MM-DD string, never a time.
function computeNextRruleOccurrence(rrule, fromDate) {
    const text = String(rrule || '').replace(/^RRULE\s*:/i, '').trim().toUpperCase();
    if (!text) return null;
    // Cross-realm coercion, NOT defensive padding. Scriptable loads every file
    // through its own importModule, so `event-schema` and the parsers hold
    // different Date constructors: a Date built in ai-web-parser fails
    // `instanceof Date` here even though it is a perfectly good Date. This was
    // the ONLY date-taking function in this file lacking the coercion its
    // siblings already do (formatIcsDate:632, parseIcsDate:641,
    // buildRecurringEventIcs:696) — so it returned null for every real caller,
    // silently disabling BOTH the dateless-weekly synthesis (#1616) and the
    // older derived-occurrence path (#1563). Measured 2026-08-03: the success
    // log line `🔁 RECURRING: derived next occurrence` appears ZERO times
    // across every run ever recorded on device.
    // Reject the absent cases BEFORE coercing: `new Date(null)` is epoch 0, a
    // perfectly valid Date, which would turn "no anchor supplied" into a 1969
    // occurrence. Same order of checks as SharedCore.toEpochMillis.
    if (fromDate === null || fromDate === undefined || fromDate === '') return null;
    const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
    if (Number.isNaN(from.getTime())) return null;
    const parts = {};
    for (const segment of text.split(';')) {
        const eq = segment.indexOf('=');
        if (eq <= 0) continue;
        parts[segment.slice(0, eq)] = segment.slice(eq + 1);
    }
    if (parts.INTERVAL !== undefined && Number(parts.INTERVAL) !== 1) return null;
    const WEEKDAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const pad2 = (value) => String(value).padStart(2, '0');
    const formatLocalDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    if (parts.FREQ === 'DAILY') {
        return parts.BYDAY === undefined ? formatLocalDate(today) : null;
    }
    if (parts.FREQ === 'WEEKLY') {
        const codes = String(parts.BYDAY || '').split(',').map(code => code.trim()).filter(Boolean);
        if (codes.length === 0) return null;
        let best = null;
        for (const code of codes) {
            const weekday = WEEKDAY_INDEX[code];
            if (weekday === undefined) return null;
            const delta = (weekday - today.getDay() + 7) % 7;
            if (best === null || delta < best) best = delta;
        }
        return formatLocalDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + best));
    }
    if (parts.FREQ === 'MONTHLY') {
        const codes = String(parts.BYDAY || '').split(',').map(code => code.trim()).filter(Boolean);
        if (codes.length !== 1) return null;
        const match = codes[0].match(/^(-?\d)(SU|MO|TU|WE|TH|FR|SA)$/);
        if (!match) return null;
        const ordinal = Number(match[1]);
        const weekday = WEEKDAY_INDEX[match[2]];
        if (ordinal === 0 || ordinal > 5 || ordinal < -1) return null;
        const ordinalWeekdayOfMonth = (year, month) => {
            if (ordinal > 0) {
                const first = new Date(year, month, 1);
                const day = 1 + ((weekday - first.getDay() + 7) % 7) + (ordinal - 1) * 7;
                const candidate = new Date(year, month, day);
                return candidate.getMonth() === first.getMonth() ? candidate : null;
            }
            const last = new Date(year, month + 1, 0);
            return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
        };
        for (let offset = 0; offset < 3; offset++) {
            const candidate = ordinalWeekdayOfMonth(today.getFullYear(), today.getMonth() + offset);
            if (candidate && candidate.getTime() >= today.getTime()) return formatLocalDate(candidate);
        }
        return null;
    }
    return null;
}

const EventSchema = {
    EVENT_KEY_ALIASES,
    URL_LIKE_FIELDS,
    DEFAULT_NOTES_EXCLUDED_FIELDS,
    EVENT_PARAM_MAP: EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY,
    EVENT_BUILDER_STATE_KEY_BY_EVENT_KEY,
    AI_PROMPT_FIELDS,
    AI_FIELD_SIGNAL_REGEXES,
    normalizeAliasKey,
    canonicalizeEventKey,
    findUnescaped,
    unescapeText,
    escapeText,
    isValidMetadataKey,
    isUrlLikeField,
    parseNotesIntoFields,
    formatEventNotes,
    pickImageForOrientation,
    imageAssetKey,
    isSameImageAsset,
    getEventBuilderStateKey,
    escapeIcsText,
    foldIcsLine,
    formatIcsDateUtc,
    formatIcsDateInTimezone,
    slugifyIcsText,
    buildRecurringEventIcs,
    computeNextRruleOccurrence
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

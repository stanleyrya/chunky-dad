// Convert the festivals Google Calendar (ICS) into data/festivals.json.
//
// Flow:
//   - Reads data/calendars/festivals.ics (written by the update-calendar-data
//     workflow's fetch step). With --fetch, fetches the public ICS URL instead.
//   - Parses VEVENTs with js/calendar-core.js (same bootstrapping as
//     tools/process-calendars.js) and converts each VEVENT into a festival
//     entry matching the curated data/festivals.json schema.
//
// Safety (curated data beats derived, fail closed): if the ICS is missing,
// unfetchable, parses to 0 VEVENTs, or converts to fewer than
// MIN_ENTRIES_TO_WRITE entries, data/festivals.json is left untouched and the
// script exits 0 so CI never clobbers the curated file on a bad/empty/
// not-yet-public calendar.

const fs = require('fs');
const path = require('path');
const https = require('https');

const FESTIVALS_CALENDAR_ID = '8ffa89eaf28d762b93e9c18ff5cb7390ee24228acb07b78c0f3cf2abd2025742@group.calendar.google.com';
const FESTIVALS_ICS_URL = `https://calendar.google.com/calendar/ical/${FESTIVALS_CALENDAR_ID}/public/basic.ics`;

const MIN_ENTRIES_TO_WRITE = 5;
// A recurring occurrence counts as "next" while its start is no more than this
// many days in the past (keeps an in-progress festival on its current dates).
const UPCOMING_GRACE_DAYS = 7;

// Resolve project root
const ROOT = path.resolve(__dirname, '..');

const ICS_PATH = path.join(ROOT, 'data', 'calendars', 'festivals.ics');
const JSON_PATH = path.join(ROOT, 'data', 'festivals.json');

// Provide basic logging to satisfy dependencies (mirror tools/process-calendars.js)
global.logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: console.error,
    componentInit: () => {},
    componentLoad: () => {},
    componentError: () => {},
    time: () => {},
    timeEnd: () => {},
    apiCall: () => {},
    performance: () => {}
};

// Load EventSchema and CalendarCore
const evSch = require(path.join(ROOT, 'js', 'event-schema.js'));
global.EventSchema = evSch.EventSchema;
const CalendarCore = require(path.join(ROOT, 'js', 'calendar-core.js'));

// ---------------------------------------------------------------------------
// Small date helpers ({ y, m, d } plain-date triples; arithmetic at UTC noon
// so DST can never shift a day)
// ---------------------------------------------------------------------------

function plainDateFromLocal(date) {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

function plainDateFromYmd8(ymd8) {
    return {
        y: parseInt(ymd8.substring(0, 4), 10),
        m: parseInt(ymd8.substring(4, 6), 10),
        d: parseInt(ymd8.substring(6, 8), 10)
    };
}

function plainDateToUtcNoon(pd) {
    return new Date(Date.UTC(pd.y, pd.m - 1, pd.d, 12, 0, 0));
}

function addDays(pd, days) {
    const dt = plainDateToUtcNoon(pd);
    dt.setUTCDate(dt.getUTCDate() + days);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function daysBetween(a, b) {
    return Math.round((plainDateToUtcNoon(b) - plainDateToUtcNoon(a)) / 86400000);
}

function fmtPlainDate(pd) {
    const mm = String(pd.m).padStart(2, '0');
    const dd = String(pd.d).padStart(2, '0');
    return `${pd.y}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Raw VEVENT block parsing (supplemental)
//
// calendar-core's parseEventData keeps the raw DESCRIPTION (as
// unprocessedDescription) but destroys the raw LOCATION text (it coerces it
// into {lat,lng} coordinates) and does not expose whether DTSTART was an
// all-day VALUE=DATE. Parse those two things straight from the ICS text.
// ---------------------------------------------------------------------------

function unfoldIcsLines(icsText) {
    const rawLines = icsText.split('\n');
    const lines = [];
    for (let i = 0; i < rawLines.length; i++) {
        let line = rawLines[i];
        while (i + 1 < rawLines.length && (rawLines[i + 1].startsWith(' ') || rawLines[i + 1].startsWith('\t'))) {
            i++;
            line += rawLines[i].substring(1).replace(/\r$/, '');
        }
        lines.push(line.replace(/\r$/, ''));
    }
    return lines;
}

function unescapeIcsText(value) {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\:/g, ':')
        .replace(/\\\\/g, '\\');
}

function parseRawVevents(icsText) {
    const blocks = [];
    let current = null;
    for (const line of unfoldIcsLines(icsText)) {
        if (line === 'BEGIN:VEVENT') {
            current = { uid: null, hasRecurrenceId: false, location: null, allDay: false, dtstartRaw: null, dtendRaw: null };
        } else if (line === 'END:VEVENT') {
            if (current) blocks.push(current);
            current = null;
        } else if (current) {
            let m;
            if ((m = line.match(/^UID:(.*)$/))) {
                current.uid = m[1].trim();
            } else if (line.startsWith('RECURRENCE-ID')) {
                current.hasRecurrenceId = true;
            } else if ((m = line.match(/^LOCATION(?:;[^:]*)?:(.*)$/))) {
                const loc = unescapeIcsText(m[1]).trim();
                current.location = loc || null;
            } else if ((m = line.match(/^DTSTART(?:;[^:]*)?:(.+)$/))) {
                current.dtstartRaw = m[1].trim();
                if (line.includes('VALUE=DATE') || /^\d{8}$/.test(current.dtstartRaw)) {
                    current.allDay = true;
                }
            } else if ((m = line.match(/^DTEND(?:;[^:]*)?:(.+)$/))) {
                current.dtendRaw = m[1].trim();
            }
        }
    }
    return blocks;
}

// Match a parsed event back to its raw block: same UID, preferring the block
// whose DTSTART date matches the event's local start date (disambiguates
// recurrence overrides), then matching RECURRENCE-ID presence.
function findRawBlock(rawBlocks, event) {
    const candidates = rawBlocks.filter(b => b.uid && b.uid === event.uid);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    if (event.startDate instanceof Date && !isNaN(event.startDate)) {
        const startStr = fmtPlainDate(plainDateFromLocal(event.startDate)).replace(/-/g, '');
        const byDate = candidates.find(b => b.dtstartRaw && b.dtstartRaw.substring(0, 8) === startStr);
        if (byDate) return byDate;
    }
    const byRecurrence = candidates.find(b => b.hasRecurrenceId === !!event.recurrenceId);
    return byRecurrence || candidates[0];
}

// ---------------------------------------------------------------------------
// Custom description keys
//
// calendar-core's parseEventData runs descriptions through an allow-list that
// drops our custom festival keys, so parse them from the raw description text
// it preserves on event.unprocessedDescription ("key: value" lines, split on
// the first colon).
// ---------------------------------------------------------------------------

const DESCRIPTION_KEYS = {
    key: 'key',
    category: 'category',
    citykey: 'cityKey',
    website: 'website',
    instagram: 'instagram',
    typicaltiming: 'typicalTiming',
    emoji: 'emoji',
    estimated: 'estimated',
    recurring: 'recurring'
};

function parseDescriptionKeys(descriptionText) {
    const result = {};
    if (!descriptionText) return result;
    // calendar-core unescapes DESCRIPTION before stripping the \r that its
    // unfolding leaves between a fold's two halves, so an escape sequence
    // split across a fold (e.g. "\" CRLF " n") survives as a literal
    // backslash sequence. Strip \r first, then unescape any residue.
    const cleaned = unescapeIcsText(descriptionText.replace(/\r/g, ''));
    for (const rawLine of cleaned.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const colonIndex = line.indexOf(':');
        if (colonIndex <= 0) continue;
        const rawKey = line.substring(0, colonIndex).trim();
        const canonical = DESCRIPTION_KEYS[rawKey.toLowerCase().replace(/[^a-z0-9]/g, '')];
        if (!canonical) continue;
        const value = line.substring(colonIndex + 1).trim();
        if (value) result[canonical] = value;
    }
    return result;
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function isEstimated(descKeys) {
    return /^(true|yes|1)$/i.test(descKeys.estimated || '');
}

// ---------------------------------------------------------------------------
// Occurrence (nextDates) computation
// ---------------------------------------------------------------------------

// Inclusive {start,end} plain-date range for a single VEVENT.
function eventDateRange(event, rawBlock) {
    if (rawBlock && rawBlock.allDay && rawBlock.dtstartRaw && /^\d{8}$/.test(rawBlock.dtstartRaw)) {
        const start = plainDateFromYmd8(rawBlock.dtstartRaw);
        if (rawBlock.dtendRaw && /^\d{8}$/.test(rawBlock.dtendRaw)) {
            // Google's all-day DTEND is exclusive: subtract a day for the inclusive end
            const end = addDays(plainDateFromYmd8(rawBlock.dtendRaw), -1);
            return { start, end: daysBetween(start, end) < 0 ? start : end };
        }
        return { start, end: start };
    }
    if (!(event.startDate instanceof Date) || isNaN(event.startDate)) return null;
    const start = plainDateFromLocal(event.startDate);
    let end = start;
    if (event.endDate instanceof Date && !isNaN(event.endDate)) {
        end = plainDateFromLocal(event.endDate);
        if (daysBetween(start, end) < 0) end = start;
    }
    return { start, end };
}

function isYearlyRecurrence(recurrence) {
    return typeof recurrence === 'string' && /FREQ=YEARLY/i.test(recurrence);
}

// Next YEARLY occurrence >= cutoff, advancing the base date by whole years
// (same month/day), preserving the duration in days.
function nextYearlyOccurrence(baseRange, cutoffStr) {
    const durationDays = daysBetween(baseRange.start, baseRange.end);
    for (let year = baseRange.start.y; year <= baseRange.start.y + 100; year++) {
        const start = { y: year, m: baseRange.start.m, d: baseRange.start.d };
        if (fmtPlainDate(start) >= cutoffStr) {
            return { start, end: addDays(start, durationDays) };
        }
    }
    return baseRange;
}

// ---------------------------------------------------------------------------
// VEVENT -> festival entry conversion
// ---------------------------------------------------------------------------

const KNOWN_CATEGORIES = ['bear-run', 'pride', 'kink', 'festival'];

function buildEntry(event, range, rawBlock, warnings) {
    const descKeys = parseDescriptionKeys(event.unprocessedDescription);
    const name = (event.name || '').trim();
    const estimated = isEstimated(descKeys);
    const dated = !estimated && !!range;

    const entry = {
        key: descKeys.key || slugify(name),
        name,
        category: descKeys.category || 'festival',
        recurring: descKeys.recurring || 'annual'
    };
    if (descKeys.cityKey) entry.cityKey = descKeys.cityKey;

    const location = (rawBlock && rawBlock.location) || null;
    if (location) entry.location = location;

    entry.typicalTiming = descKeys.typicalTiming || '';
    if (descKeys.website) {
        entry.website = descKeys.website;
    } else if (event.website) {
        entry.website = event.website;
    }
    if (descKeys.instagram) entry.instagram = descKeys.instagram;
    if (descKeys.emoji) entry.emoji = descKeys.emoji;
    if (dated) {
        entry.nextDates = { start: fmtPlainDate(range.start), end: fmtPlainDate(range.end) };
    }

    if (!KNOWN_CATEGORIES.includes(entry.category)) {
        warnings.push(`"${name}": unknown category "${entry.category}" (expected one of ${KNOWN_CATEGORIES.join(', ')})`);
    }
    const missing = [];
    if (!descKeys.key) missing.push('key (derived from summary)');
    if (!descKeys.typicalTiming && !dated) missing.push('typicalTiming (undated entry will render blank)');
    if (!entry.website) missing.push('website');
    if (missing.length > 0) {
        warnings.push(`"${name}": missing ${missing.join(', ')}`);
    }
    return entry;
}

function convertEvents(events, rawBlocks, todayStr, cutoffStr) {
    const warnings = [];
    const candidates = [];

    // Group by UID so recurrence overrides can pair with their base series
    const groups = new Map();
    for (const event of events) {
        const groupKey = event.uid || `__no_uid_${groups.size}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(event);
    }

    for (const group of groups.values()) {
        const base = group.find(e => !e.recurrenceId) || null;
        const overrides = group.filter(e => !!e.recurrenceId);
        if (group.filter(e => !e.recurrenceId).length > 1) {
            warnings.push(`UID ${group[0].uid}: multiple non-override VEVENTs; using the first as the series base`);
        }

        const standalone = [];

        if (base) {
            const baseRaw = findRawBlock(rawBlocks, base);
            const baseDescKeys = parseDescriptionKeys(base.unprocessedDescription);
            const baseRange = eventDateRange(base, baseRaw);

            if (base.recurrence && !isYearlyRecurrence(base.recurrence)) {
                warnings.push(`"${base.name}": non-yearly RRULE (${base.recurrence}); using its base dates as a single occurrence`);
            }

            if (isYearlyRecurrence(base.recurrence) && !isEstimated(baseDescKeys) && baseRange) {
                // Candidate occurrences: computed base years (skipping overridden
                // years) plus the override instances themselves; the nearest one
                // that is still upcoming wins.
                const overriddenYears = new Set(
                    overrides
                        .filter(o => o.recurrenceId instanceof Date && !isNaN(o.recurrenceId))
                        .map(o => o.recurrenceId.getFullYear())
                );
                const occurrences = [];
                for (const override of overrides) {
                    const overrideRaw = findRawBlock(rawBlocks, override);
                    const overrideRange = eventDateRange(override, overrideRaw);
                    if (overrideRange) occurrences.push({ event: override, raw: overrideRaw, range: overrideRange });
                }
                const durationDays = daysBetween(baseRange.start, baseRange.end);
                for (let year = baseRange.start.y; year <= baseRange.start.y + 100; year++) {
                    if (overriddenYears.has(year)) continue;
                    const start = { y: year, m: baseRange.start.m, d: baseRange.start.d };
                    if (fmtPlainDate(start) >= cutoffStr) {
                        occurrences.push({ event: base, raw: baseRaw, range: { start, end: addDays(start, durationDays) } });
                        break;
                    }
                }
                occurrences.sort((a, b) => fmtPlainDate(a.range.start).localeCompare(fmtPlainDate(b.range.start)));
                const chosen = occurrences.find(o => fmtPlainDate(o.range.start) >= cutoffStr) || occurrences[occurrences.length - 1];
                if (chosen) {
                    candidates.push(buildEntry(chosen.event, chosen.range, chosen.raw, warnings));
                } else {
                    candidates.push(buildEntry(base, nextYearlyOccurrence(baseRange, cutoffStr), baseRaw, warnings));
                }
            } else {
                // Estimated series (no nextDates), plain dated event, or
                // non-yearly recurrence treated as a single occurrence.
                candidates.push(buildEntry(base, baseRange, baseRaw, warnings));
                // Overrides of an estimated/non-yearly base become standalone
                // candidates; key-dedupe below resolves them.
                standalone.push(...overrides);
            }
        } else {
            standalone.push(...group);
        }

        for (const event of standalone) {
            const raw = findRawBlock(rawBlocks, event);
            candidates.push(buildEntry(event, eventDateRange(event, raw), raw, warnings));
        }
    }

    // Dedupe by key: prefer the nearest upcoming dated entry, then undated
    // (estimated) entries, then the most recent past dated entry.
    function rank(entry) {
        if (!entry.nextDates) return { tier: 1, sortKey: '' };
        if (entry.nextDates.start >= cutoffStr) return { tier: 0, sortKey: entry.nextDates.start };
        return { tier: 2, sortKey: entry.nextDates.start };
    }
    function beats(a, b) {
        const ra = rank(a);
        const rb = rank(b);
        if (ra.tier !== rb.tier) return ra.tier < rb.tier;
        if (ra.tier === 0) return ra.sortKey < rb.sortKey;   // nearest upcoming
        if (ra.tier === 2) return ra.sortKey > rb.sortKey;   // most recent past
        return false;                                        // undated: keep first
    }
    const byKey = new Map();
    for (const entry of candidates) {
        const existing = byKey.get(entry.key);
        if (!existing) {
            byKey.set(entry.key, entry);
        } else {
            const winner = beats(entry, existing) ? entry : existing;
            const loser = winner === entry ? existing : entry;
            warnings.push(`duplicate key "${entry.key}": kept ${winner.nextDates ? winner.nextDates.start : 'undated'}, dropped ${loser.nextDates ? loser.nextDates.start : 'undated'}`);
            byKey.set(entry.key, winner);
        }
    }

    // Order: dated entries chronological by nextDates.start, then undated
    // alphabetical by name (matches the curated file's ordering).
    const entries = Array.from(byKey.values());
    const datedEntries = entries.filter(e => e.nextDates).sort((a, b) =>
        a.nextDates.start.localeCompare(b.nextDates.start) || a.name.localeCompare(b.name));
    const undatedEntries = entries.filter(e => !e.nextDates).sort((a, b) => a.name.localeCompare(b.name));

    return { entries: [...datedEntries, ...undatedEntries], warnings, todayStr };
}

// ---------------------------------------------------------------------------
// Serialization — byte-compatible with the curated data/festivals.json
// (2-space indent, nextDates inline on one line, trailing newline)
// ---------------------------------------------------------------------------

const FIELD_ORDER = ['key', 'name', 'category', 'cityKey', 'location', 'typicalTiming', 'recurring', 'website', 'instagram', 'emoji'];

function serializeFestivals(entries) {
    const entryBlocks = entries.map(entry => {
        const lines = [];
        for (const field of FIELD_ORDER) {
            if (entry[field] === undefined) continue;
            lines.push(`      ${JSON.stringify(field)}: ${JSON.stringify(entry[field])}`);
        }
        if (entry.nextDates) {
            lines.push(`      "nextDates": { "start": ${JSON.stringify(entry.nextDates.start)}, "end": ${JSON.stringify(entry.nextDates.end)} }`);
        }
        return `    {\n${lines.join(',\n')}\n    }`;
    });
    return `{\n  "festivals": [\n${entryBlocks.join(',\n')}\n  ]\n}\n`;
}

// ---------------------------------------------------------------------------
// ICS acquisition
// ---------------------------------------------------------------------------

function fetchUrl(url, redirectsLeft) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (redirectsLeft <= 0) {
                    reject(new Error(`Too many redirects fetching ${url}`));
                    return;
                }
                resolve(fetchUrl(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
                return;
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function loadIcsText(useFetch) {
    if (useFetch) {
        console.log(`Fetching festivals calendar from ${FESTIVALS_ICS_URL}`);
        try {
            return await fetchUrl(FESTIVALS_ICS_URL, 1);
        } catch (error) {
            console.warn(`⚠️  Festivals calendar fetch failed: ${error.message}`);
            return null;
        }
    }
    if (fs.existsSync(ICS_PATH)) {
        return fs.readFileSync(ICS_PATH, 'utf8');
    }
    return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const useFetch = process.argv.includes('--fetch');
    const icsText = await loadIcsText(useFetch);

    if (!icsText || !icsText.includes('BEGIN:VCALENDAR')) {
        let reason;
        if (useFetch) {
            reason = 'fetch failed or returned invalid data';
        } else if (icsText) {
            reason = `${ICS_PATH} is not valid iCal data`;
        } else {
            reason = `missing ${ICS_PATH}; run with --fetch to fetch directly`;
        }
        console.warn(`⚠️  Festivals: no usable ICS (${reason}). Keeping curated data/festivals.json untouched.`);
        return;
    }

    // Mirror tools/process-calendars.js TZ handling
    try {
        const tzMatch = icsText.match(/X-WR-TIMEZONE:(.+)/);
        if (tzMatch && tzMatch[1]) {
            process.env.TZ = tzMatch[1].trim();
        }
    } catch (_) {}

    const calendar = new CalendarCore();
    const events = calendar.parseICalData(icsText) || [];
    if (events.length === 0) {
        console.warn('⚠️  Festivals: parsed 0 VEVENTs from the ICS. Keeping curated data/festivals.json untouched.');
        return;
    }

    const now = new Date();
    const todayStr = fmtPlainDate(plainDateFromLocal(now));
    const cutoffStr = fmtPlainDate(addDays(plainDateFromLocal(now), -UPCOMING_GRACE_DAYS));

    const rawBlocks = parseRawVevents(icsText);
    const { entries, warnings } = convertEvents(events, rawBlocks, todayStr, cutoffStr);

    for (const warning of warnings) {
        console.warn(`⚠️  Festivals: ${warning}`);
    }

    if (entries.length < MIN_ENTRIES_TO_WRITE) {
        console.warn(`⚠️  Festivals: only ${entries.length} entries converted (need at least ${MIN_ENTRIES_TO_WRITE}). Keeping curated data/festivals.json untouched.`);
        return;
    }

    const output = serializeFestivals(entries);
    const existing = fs.existsSync(JSON_PATH) ? fs.readFileSync(JSON_PATH, 'utf8') : null;
    const datedCount = entries.filter(e => e.nextDates).length;
    const undatedCount = entries.length - datedCount;

    if (existing === output) {
        console.log('Festivals: no changes');
        return;
    }
    fs.writeFileSync(JSON_PATH, output);
    console.log(`Festivals: ${entries.length} entries (${datedCount} dated, ${undatedCount} estimated/undated) written`);
}

main().catch(error => {
    // Fail closed: never let an unexpected error surface as a bad write, but
    // do fail the step so CI notices the converter itself is broken.
    console.error('✗ Festivals conversion failed:', error);
    process.exit(1);
});

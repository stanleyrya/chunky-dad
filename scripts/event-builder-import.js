// Variables used by Scriptable.
// icon-color: deep-brown; icon-glyph: calendar-plus;

const SCRIPT_NAME = 'event-builder-import';
const DEFAULT_DURATION_MINUTES = 240;

const queryParameters = (typeof args !== 'undefined' && args.queryParameters) ? args.queryParameters : {};

function buildParamMap(input) {
    const map = {};
    if (!input || typeof input !== 'object') return map;
    Object.keys(input).forEach(key => {
        const value = input[key];
        if (value === undefined) return;
        map[key] = value;
        map[key.toLowerCase()] = value;
    });
    return map;
}

function parseQueryString(queryString) {
    const params = {};
    if (!queryString) return params;
    const pairs = queryString.split('&').filter(Boolean);
    pairs.forEach(pair => {
        const separatorIndex = pair.indexOf('=');
        const rawKey = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
        const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';
        if (!rawKey) return;
        const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
        const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
        params[key] = value;
    });
    return params;
}

function parseUrlParams(url) {
    if (!url) return {};
    const raw = String(url).trim();
    if (!raw) return {};
    const queryIndex = raw.indexOf('?');
    if (queryIndex === -1) return {};
    const hashIndex = raw.indexOf('#', queryIndex);
    const queryString = raw.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
    return parseQueryString(queryString);
}

function readParam(params, keys) {
    for (const key of keys) {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
            return params[key];
        }
        const lowerKey = key.toLowerCase();
        if (params[lowerKey] !== undefined && params[lowerKey] !== null && params[lowerKey] !== '') {
            return params[lowerKey];
        }
    }
    return '';
}

function cleanText(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
}

function parseDateTime(value) {
    if (value instanceof Date) {
        return isValidDate(value) ? value : null;
    }
    const raw = cleanText(value);
    if (!raw) return null;
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const parsed = new Date(normalized);
    return isValidDate(parsed) ? parsed : null;
}

function resolveEndDate(startDate, endValue) {
    const parsedEnd = parseDateTime(endValue);
    if (!isValidDate(startDate)) return parsedEnd;
    if (!isValidDate(parsedEnd) || parsedEnd <= startDate) {
        return new Date(startDate.getTime() + DEFAULT_DURATION_MINUTES * 60000);
    }
    return parsedEnd;
}

function buildFieldPriorities(event) {
    const priorities = {};
    const fieldsToClobber = [
        'title', 'shortName', 'description', 'bar', 'address', 'location',
        'cover', 'startDate', 'endDate', 'recurrence', 'website', 'ticketUrl',
        'instagram', 'facebook', 'gmaps', 'image', 'city', 'timezone', 'url'
    ];
    fieldsToClobber.forEach(fieldName => {
        const value = event[fieldName];
        if (value instanceof Date) {
            if (isValidDate(value)) {
                priorities[fieldName] = { merge: 'clobber' };
            }
            return;
        }
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            priorities[fieldName] = { merge: 'clobber' };
        }
    });
    return priorities;
}

function buildEventFromParams(params) {
    const name = cleanText(readParam(params, ['name', 'title']));
    const shortName = cleanText(readParam(params, ['short', 'shortname', 'shortName']));
    const venue = cleanText(readParam(params, ['venue', 'bar']));
    const address = cleanText(readParam(params, ['addr', 'address']));
    const coords = cleanText(readParam(params, ['coords', 'location', 'loc']));
    const description = cleanText(readParam(params, ['desc', 'description', 'tea']));
    const cover = cleanText(readParam(params, ['cover']));
    const startValue = readParam(params, ['start', 'startdate', 'startDate']);
    const endValue = readParam(params, ['end', 'enddate', 'endDate']);
    const editMode = cleanText(readParam(params, ['emode', 'editmode']));
    const recurrenceRaw = cleanText(readParam(params, ['rrule', 'recurrence']));
    const recurrence = editMode.toLowerCase() === 'occurrence' ? '' : recurrenceRaw;
    const website = cleanText(readParam(params, ['web', 'website']));
    const ticketUrl = cleanText(readParam(params, ['tickets', 'ticket', 'ticketurl']));
    const instagram = cleanText(readParam(params, ['insta', 'instagram']));
    const facebook = cleanText(readParam(params, ['fb', 'facebook']));
    const gmaps = cleanText(readParam(params, ['gmaps']));
    const image = cleanText(readParam(params, ['img', 'image']));
    const city = cleanText(readParam(params, ['city']));
    const timezone = cleanText(readParam(params, ['tz', 'timezone', 'ertz']));
    const url = cleanText(readParam(params, ['url'])) || website || ticketUrl;
    const startDate = parseDateTime(startValue);
    const endDate = resolveEndDate(startDate, endValue);
    const title = name || shortName || 'Untitled Event';

    const event = {
        title,
        shortName,
        description,
        bar: venue,
        address,
        location: coords,
        cover,
        startDate,
        endDate,
        timezone,
        recurrence,
        recurring: Boolean(recurrence),
        website,
        ticketUrl,
        instagram,
        facebook,
        gmaps,
        image,
        city,
        url,
        source: 'event-builder'
    };

    return event;
}

async function run() {
    const directParams = buildParamMap(queryParameters);
    const builderUrl = readParam(directParams, ['builder', 'builderurl', 'shareurl', 'eventbuilderurl']);
    const builderParams = builderUrl ? buildParamMap(parseUrlParams(builderUrl)) : {};
    const params = { ...builderParams, ...directParams };

    const event = buildEventFromParams(params);
    if (!isValidDate(event.startDate) || !isValidDate(event.endDate)) {
        throw new Error('Event start/end time is missing or invalid.');
    }
    if (!event.title || event.title === 'Untitled Event') {
        throw new Error('Event name is required.');
    }

    const scraperCities = importModule('scraper-cities');
    const { SharedCore } = importModule('shared-core');
    const { ScriptableAdapter } = importModule('adapters/scriptable-adapter');

    const parserConfig = {
        name: 'Event Builder',
        enabled: true,
        dryRun: false,
        calendarSearchRangeDays: 1
    };

    const config = {
        config: { dryRun: false },
        parsers: [parserConfig],
        cities: scraperCities
    };

    const adapter = new ScriptableAdapter({ ...config, cities: scraperCities });
    const sharedCore = new SharedCore(scraperCities);

    event._parserConfig = parserConfig;
    event._fieldPriorities = buildFieldPriorities(event);

    const normalizedEvent = sharedCore.normalizeEventTextFields(event);
    const enrichedEvent = sharedCore.enrichEventLocation(normalizedEvent);
    const key = sharedCore.createEventKey(enrichedEvent);
    if (key) {
        enrichedEvent.key = key;
        enrichedEvent._fieldPriorities = enrichedEvent._fieldPriorities || {};
        enrichedEvent._fieldPriorities.key = { merge: 'clobber' };
    }

    const analyzedEvents = await sharedCore.prepareEventsForCalendar([enrichedEvent], adapter, { mergeMode: 'upsert' });

    const results = {
        totalEvents: 1,
        rawBearEvents: 1,
        bearEvents: 1,
        duplicatesRemoved: 0,
        errors: [],
        parserResults: [
            {
                name: parserConfig.name,
                totalEvents: 1,
                rawBearEvents: 1,
                bearEvents: 1,
                duplicatesRemoved: 0,
                events: [enrichedEvent]
            }
        ],
        analyzedEvents,
        allProcessedEvents: [enrichedEvent],
        config,
        runContext: {
            type: 'manual',
            environment: 'scriptable',
            trigger: 'event-builder'
        }
    };

    await adapter.displayResults(results);
}

run().catch(async error => {
    const message = error && error.message ? error.message : 'Event Builder import failed.';
    console.log(`📱 Event Builder Import: ${message}`);
    try {
        const alert = new Alert();
        alert.title = 'Event Builder Import';
        alert.message = message;
        alert.addAction('OK');
        await alert.present();
    } catch (alertError) {
        const fallback = alertError && alertError.message ? alertError.message : String(alertError);
        console.log(`📱 Event Builder Import: Alert failed: ${fallback}`);
    }
});

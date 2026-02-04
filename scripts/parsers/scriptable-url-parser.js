// ============================================================================
// SCRIPTABLE URL INPUT PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (input payload processing)
// ✅ URL query/event object normalization
// ✅ Event object creation and validation
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Environment detection (typeof importModule, typeof window, typeof DOMParser)
// ❌ HTTP requests (receive payload data, don't fetch it)
// ❌ Calendar operations (return event objects, don't save them)
// ❌ Scriptable APIs (Request, Calendar, FileManager, Alert)
// ❌ DOM APIs (DOMParser, document, window) - use pure JS
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class ScriptableUrlParser {
    constructor(config = {}) {
        this.config = {
            source: 'scriptable-input',
            ...config
        };
    }

    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const payload = this.getInputPayload(htmlData, parserConfig);
            if (!payload) {
                console.warn('🔗 Scriptable URL: No input payload provided');
                return this.buildEmptyResult(htmlData);
            }

            const event = this.buildEventFromPayload(payload, parserConfig, cityConfig);
            if (!event) {
                console.warn('🔗 Scriptable URL: No valid event data found');
                return this.buildEmptyResult(htmlData);
            }

            return {
                events: [event],
                additionalLinks: [],
                source: this.config.source,
                url: htmlData && htmlData.url ? htmlData.url : ''
            };
        } catch (error) {
            console.error(`🔗 Scriptable URL: Error parsing input: ${error}`);
            return this.buildEmptyResult(htmlData);
        }
    }

    buildEmptyResult(htmlData) {
        return {
            events: [],
            additionalLinks: [],
            source: this.config.source,
            url: htmlData && htmlData.url ? htmlData.url : ''
        };
    }

    getInputPayload(htmlData, parserConfig) {
        if (parserConfig && parserConfig.input && typeof parserConfig.input === 'object') {
            return parserConfig.input;
        }
        if (htmlData && htmlData.input && typeof htmlData.input === 'object') {
            return htmlData.input;
        }
        if (htmlData && typeof htmlData.html === 'string' && htmlData.html.trim()) {
            const parsed = this.safeParseJson(htmlData.html);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        }
        return null;
    }

    buildEventFromPayload(payload, parserConfig, cityConfig) {
        const queryParameters = payload.queryParameters || payload.query || payload.params || null;

        let eventData = payload.event || payload.data || payload.payload || null;
        if (typeof eventData === 'string') {
            eventData = this.safeParseJson(eventData);
        }

        if (!eventData && queryParameters && typeof queryParameters === 'object') {
            const eventJson = this.getFirstQueryValue(queryParameters, [
                'event', 'eventJson', 'event_json', 'payload', 'data'
            ]);
            if (eventJson) {
                eventData = this.safeParseJson(eventJson);
            }
        }

        const rawData = (eventData && typeof eventData === 'object')
            ? eventData
            : (queryParameters && typeof queryParameters === 'object')
                ? queryParameters
                : null;

        if (!rawData) {
            return null;
        }

        const { fields, inputFields } = this.normalizeInputFields(rawData);

        this.applyCoordinateFallbacks(fields, inputFields);

        const dateInfo = this.resolveEventDates(fields);
        if (!dateInfo.startDate) {
            console.warn('🔗 Scriptable URL: Missing or invalid startDate');
            return null;
        }

        const event = {
            ...fields,
            startDate: dateInfo.startDate,
            endDate: dateInfo.endDate,
            source: fields.source || this.config.source
        };

        if (!event.endDate) {
            event.endDate = new Date(event.startDate);
        }

        if (!event.title || String(event.title).trim().length === 0) {
            console.warn('🔗 Scriptable URL: Missing event title');
            return null;
        }

        if (!event.bar && event.location && !this.isCoordinateString(event.location)) {
            event.bar = event.location;
            if (inputFields.has('location')) {
                inputFields.add('bar');
            }
        }

        this.stripHelperFields(event);
        this.applyFieldPriorities(event, inputFields, dateInfo);

        return event;
    }

    normalizeInputFields(rawData) {
        const fields = {};
        const inputFields = new Set();
        const reservedKeys = new Set([
            'scriptname', 'script', 'action', 'callback', 'callbackurl',
            'xsuccess', 'xerror', 'xcancel', 'xsource'
        ]);

        Object.entries(rawData || {}).forEach(([key, value]) => {
            if (key === null || key === undefined) {
                return;
            }
            const normalizedKey = String(key).trim();
            if (!normalizedKey) {
                return;
            }

            const compactKey = normalizedKey.toLowerCase().replace(/[\s\-_]/g, '');
            if (reservedKeys.has(compactKey)) {
                return;
            }

            const canonicalKey = this.getCanonicalKey(normalizedKey);
            const normalizedValue = this.normalizeValue(value);

            if (normalizedValue === undefined) {
                return;
            }

            fields[canonicalKey] = normalizedValue;
            inputFields.add(canonicalKey);
        });

        return { fields, inputFields };
    }

    getCanonicalKey(key) {
        const normalized = String(key).toLowerCase().replace(/[\s\-_]/g, '');
        const aliasMap = {
            'title': 'title',
            'name': 'title',
            'summary': 'title',
            'eventname': 'title',

            'description': 'description',
            'desc': 'description',
            'details': 'description',

            'startdate': 'startDate',
            'start': 'startDate',
            'starttime': 'startTime',

            'enddate': 'endDate',
            'end': 'endDate',
            'endtime': 'endTime',

            'date': 'date',
            'eventdate': 'date',

            'venue': 'bar',
            'bar': 'bar',
            'host': 'bar',

            'location': 'location',
            'address': 'address',

            'city': 'city',
            'timezone': 'timezone',
            'timezoneid': 'timezone',
            'tz': 'timezone',

            'url': 'url',
            'link': 'url',
            'eventurl': 'url',
            'eventlink': 'url',

            'ticketurl': 'ticketUrl',
            'ticketlink': 'ticketUrl',
            'ticket': 'ticketUrl',
            'tickets': 'ticketUrl',

            'gmaps': 'gmaps',
            'googlemaps': 'gmaps',
            'map': 'gmaps',

            'image': 'image',
            'photo': 'image',
            'cover': 'cover',

            'shortname': 'shortName',
            'shorttitle': 'shortName',
            'shortername': 'shorterName',

            'instagram': 'instagram',
            'facebook': 'facebook',
            'website': 'website',
            'twitter': 'twitter',

            'key': 'key',
            'matchkey': 'matchKey',

            'identifier': 'identifier',
            'id': 'identifier',

            'recurrenceid': 'recurrenceId',
            'sequence': 'sequence',
            'sequenced': 'sequence',
            'seq': 'sequence',

            'coordinates': 'coordinates',
            'latitude': 'lat',
            'longitude': 'lng',
            'lat': 'lat',
            'lng': 'lng',

            'durationminutes': 'durationMinutes',
            'durationmins': 'durationMinutes',
            'durationmin': 'durationMinutes',
            'durationhours': 'durationHours',
            'duration': 'durationMinutes'
        };

        if (aliasMap.hasOwnProperty(normalized)) {
            return aliasMap[normalized];
        }

        return key;
    }

    normalizeValue(value) {
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return '';
            }
            return this.normalizeValue(value[0]);
        }
        if (value instanceof Date) {
            return value;
        }
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === 'string') {
            return value.trim();
        }
        return value;
    }

    safeParseJson(value) {
        if (!value || typeof value !== 'string') {
            return null;
        }
        try {
            return JSON.parse(value);
        } catch (error) {
            console.warn(`🔗 Scriptable URL: Failed to parse JSON payload: ${error}`);
            return null;
        }
    }

    getFirstQueryValue(queryParameters, keys) {
        if (!queryParameters || typeof queryParameters !== 'object') {
            return null;
        }
        for (const key of keys) {
            if (queryParameters[key] !== undefined && queryParameters[key] !== null) {
                const value = this.normalizeValue(queryParameters[key]);
                if (value !== undefined && value !== null && String(value).trim().length > 0) {
                    return value;
                }
            }
        }
        return null;
    }

    applyCoordinateFallbacks(fields, inputFields) {
        if (!fields || typeof fields !== 'object') {
            return;
        }

        if (!fields.location && fields.coordinates) {
            if (typeof fields.coordinates === 'string') {
                fields.location = fields.coordinates;
                inputFields.add('location');
            } else if (fields.coordinates.lat !== undefined && fields.coordinates.lng !== undefined) {
                fields.location = `${fields.coordinates.lat}, ${fields.coordinates.lng}`;
                inputFields.add('location');
            }
        }

        if (!fields.location && fields.lat !== undefined && fields.lng !== undefined) {
            fields.location = `${fields.lat}, ${fields.lng}`;
            inputFields.add('location');
        }
    }

    resolveEventDates(fields) {
        const startDateValue = fields.startDate || null;
        const endDateValue = fields.endDate || null;
        const dateValue = fields.date || null;
        const startTime = fields.startTime || null;
        const endTime = fields.endTime || null;

        let explicitStartDate = false;
        let explicitEndDate = false;

        let startDate = this.parseDate(startDateValue);
        if (startDate && startDateValue !== null && startDateValue !== undefined) {
            explicitStartDate = true;
        }

        if (!startDate && dateValue && startTime) {
            startDate = this.parseDate(`${dateValue}T${startTime}`);
            explicitStartDate = Boolean(startDate);
        }

        if (!startDate && dateValue) {
            startDate = this.parseDate(dateValue);
            if (startDate) {
                explicitStartDate = true;
            }
        }

        let endDate = this.parseDate(endDateValue);
        if (endDate && endDateValue !== null && endDateValue !== undefined) {
            explicitEndDate = true;
        }

        if (!endDate && dateValue && endTime) {
            endDate = this.parseDate(`${dateValue}T${endTime}`);
            explicitEndDate = Boolean(endDate);
        }

        if (!endDate && startDate) {
            const durationMinutes = this.parseNumber(fields.durationMinutes);
            const durationHours = this.parseNumber(fields.durationHours);
            const duration = this.parseNumber(fields.duration);

            if (durationMinutes) {
                endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
                explicitEndDate = true;
            } else if (durationHours) {
                endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);
                explicitEndDate = true;
            } else if (duration) {
                endDate = new Date(startDate.getTime() + duration * 60 * 1000);
                explicitEndDate = true;
            }
        }

        if (!endDate && startDate) {
            endDate = new Date(startDate);
        }

        return {
            startDate,
            endDate,
            explicitStartDate,
            explicitEndDate
        };
    }

    parseDate(value) {
        if (!value) return null;
        if (value instanceof Date) {
            return isNaN(value.getTime()) ? null : value;
        }
        if (typeof value === 'number') {
            const date = new Date(value);
            return isNaN(date.getTime()) ? null : date;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return null;
            const date = new Date(trimmed);
            return isNaN(date.getTime()) ? null : date;
        }
        return null;
    }

    parseNumber(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? numberValue : null;
    }

    stripHelperFields(event) {
        const helperFields = [
            'date',
            'startTime',
            'endTime',
            'duration',
            'durationMinutes',
            'durationHours'
        ];

        helperFields.forEach(field => {
            if (field in event) {
                delete event[field];
            }
        });
    }

    applyFieldPriorities(event, inputFields, dateInfo) {
        if (!event || !inputFields) {
            return;
        }

        if (!event._fieldPriorities) {
            event._fieldPriorities = {};
        }

        const explicitFields = new Set(inputFields);
        if (dateInfo && dateInfo.explicitStartDate) {
            explicitFields.add('startDate');
        }
        if (dateInfo && dateInfo.explicitEndDate) {
            explicitFields.add('endDate');
        }

        explicitFields.forEach(fieldName => {
            if (!fieldName || fieldName.startsWith('_')) {
                return;
            }
            event._fieldPriorities[fieldName] = { merge: 'clobber' };
        });
    }

    isCoordinateString(value) {
        if (!value || typeof value !== 'string') return false;
        const parts = value.split(',').map(part => part.trim());
        if (parts.length !== 2) return false;
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        return Number.isFinite(lat) && Number.isFinite(lng);
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ScriptableUrlParser };
} else if (typeof window !== 'undefined') {
    window.ScriptableUrlParser = ScriptableUrlParser;
} else {
    // Scriptable environment
    this.ScriptableUrlParser = ScriptableUrlParser;
}

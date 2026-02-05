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
        return null;
    }

    buildEventFromPayload(payload, parserConfig, cityConfig) {
        const queryParameters = payload.queryParameters || payload.query || payload.params || null;
        const rawData = (queryParameters && typeof queryParameters === 'object')
            ? queryParameters
            : null;

        if (!rawData) {
            return null;
        }

        const isQueryPayload = true;
        const { fields, inputFields } = this.normalizeInputFields(rawData, {
            decodeQueryValues: isQueryPayload
        });

        this.applyCoordinateFallbacks(fields, inputFields);
        this.normalizeUrlFields(fields, inputFields);
        const orderedFields = this.orderFields(fields);

        const dateInfo = this.resolveEventDates(orderedFields);
        if (!dateInfo.startDate) {
            console.warn('🔗 Scriptable URL: Missing or invalid startDate');
            return null;
        }

        const event = {
            ...orderedFields,
            startDate: dateInfo.startDate,
            endDate: dateInfo.endDate,
            source: orderedFields.source || this.config.source
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

    normalizeInputFields(rawData, options = {}) {
        const fields = {};
        const inputFields = new Set();
        const decodeQueryValues = Boolean(options.decodeQueryValues);
        const reservedKeys = new Set([
            'scriptname', 'script', 'action', 'callback', 'callbackurl',
            'xsuccess', 'xerror', 'xcancel', 'xsource',
            'openeditor', 'event', 'eventjson', 'payload', 'data'
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
            let normalizedValue = decodeQueryValues
                ? this.normalizeQueryValue(value)
                : this.normalizeValue(value);

            if (normalizedValue === undefined) {
                return;
            }

            normalizedValue = this.normalizeUrlLikeValue(normalizedValue);
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
            'recurrenceidtimezone': 'recurrenceIdTimezone',
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

    normalizeQueryValue(value) {
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return '';
            }
            return this.normalizeQueryValue(value[0]);
        }
        if (value instanceof Date) {
            return value;
        }
        if (value === null || value === undefined) {
            return value;
        }
        if (typeof value === 'string') {
            let decoded = value.replace(/\+/g, ' ');
            if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
                try {
                    decoded = decodeURIComponent(decoded);
                } catch (error) {
                    // Keep best-effort decode for malformed inputs.
                }
            }
            return decoded.trim();
        }
        return value;
    }

    hasNonEmptyValue(value) {
        if (value === null || value === undefined) {
            return false;
        }
        if (Array.isArray(value)) {
            return value.some(item => this.hasNonEmptyValue(item));
        }
        return String(value).trim().length > 0;
    }

    isUrlLikeValue(value) {
        if (!value || typeof value !== 'string') return false;
        const lower = value.trim().toLowerCase();
        return lower.startsWith('http://') ||
            lower.startsWith('https://') ||
            lower.startsWith('mailto:') ||
            lower.startsWith('tel:') ||
            lower.startsWith('sms:');
    }

    normalizeUrlLikeValue(value) {
        if (!this.isUrlLikeValue(value)) {
            return value;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return trimmed;
        }
        const hashIndex = trimmed.indexOf('#');
        const hash = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : '';
        const withoutHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
        const queryIndex = withoutHash.indexOf('?');
        const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
        const queryString = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';
        const encodedBase = encodeURI(base);

        if (!queryString) {
            return hash ? `${encodedBase}#${hash}` : encodedBase;
        }

        const decodeComponent = (component) => {
            if (!component) return '';
            try {
                return decodeURIComponent(component.replace(/\+/g, ' '));
            } catch (error) {
                return component;
            }
        };

        const normalizedParams = queryString.split('&').map(part => {
            if (!part) return '';
            const [rawKey, ...rest] = part.split('=');
            const rawValue = rest.join('=');
            const decodedKey = decodeComponent(rawKey);
            const decodedValue = decodeComponent(rawValue);
            const encodedKey = encodeURIComponent(decodedKey);
            if (!rest.length) {
                return encodedKey;
            }
            const encodedValue = encodeURIComponent(decodedValue);
            return `${encodedKey}=${encodedValue}`;
        }).join('&');

        const normalized = `${encodedBase}?${normalizedParams}`;
        return hash ? `${normalized}#${hash}` : normalized;
    }

    normalizeUrlFields(fields, inputFields) {
        if (!fields || typeof fields !== 'object') {
            return;
        }
        const urlProvided = inputFields && inputFields.has('url');
        if (!urlProvided && this.hasNonEmptyValue(fields.website)) {
            fields.url = fields.website;
            if (inputFields) {
                inputFields.add('url');
                inputFields.delete('website');
            }
            delete fields.website;
        }
    }

    orderFields(fields) {
        if (!fields || typeof fields !== 'object') {
            return fields;
        }
        const orderedKeys = [
            'title',
            'description',
            'startDate',
            'endDate',
            'bar',
            'location',
            'address',
            'city',
            'timezone',
            'url',
            'ticketUrl',
            'cover',
            'image',
            'source',
            'isBearEvent',
            'shortName',
            'shorterName',
            'instagram',
            'facebook',
            'website',
            'twitter',
            'gmaps',
            'key',
            'matchKey',
            'identifier',
            'recurrence',
            'recurrenceId',
            'recurrenceIdTimezone',
            'sequence',
            'lat',
            'lng',
            'coordinates'
        ];
        const ordered = {};
        const seen = new Set();
        orderedKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(fields, key)) {
                ordered[key] = fields[key];
                seen.add(key);
            }
        });
        Object.keys(fields).forEach(key => {
            if (!seen.has(key)) {
                ordered[key] = fields[key];
            }
        });
        return ordered;
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
        const timezone = fields.timezone || fields.timeZone || null;

        let explicitStartDate = false;
        let explicitEndDate = false;

        let startDate = null;
        if (startDateValue && timezone) {
            startDate = SharedCore.parseDateWithTimezone(String(startDateValue), timezone);
        }
        if (!startDate) {
            startDate = this.parseDate(startDateValue);
        }
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
            const rawEnd = `${dateValue}T${endTime}`;
            if (timezone) {
                endDate = SharedCore.parseDateWithTimezone(rawEnd, timezone);
            }
            if (!endDate) {
                endDate = this.parseDate(rawEnd);
            }
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

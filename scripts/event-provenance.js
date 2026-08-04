// ============================================================================
// EVENT PROVENANCE - PURE HTML/DATA BUILDERS FOR PER-EVENT FIELD PROVENANCE
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE JavaScript business logic
//
// 🚨 CRITICAL RESTRICTIONS - NEVER ADD THESE TO THIS FILE:
// ❌ NO Node-only APIs (fs, path, process)
// ❌ NO Scriptable APIs (FileManager, WebView, Alert) - adapters own those
// ❌ NO DOM APIs (document, window) - this builds HTML strings only
//
// ✅ THIS FILE SHOULD ONLY CONTAIN:
// ✅ Plain functions that take analyzed-event objects and return HTML strings
//    or JSON-safe export payloads
//
// Builds the per-event "🔍 Provenance" <details> section shown inside each
// event card of the results WebView and the saved-run display (both render
// through ScriptableAdapter.generateEventCard), plus the "📤 Export issue"
// JSON payload for handing one event's evidence to a debugging session.
//
// Input shape (all optional — old saved runs may carry none of it):
//   event._original            { scraper, calendar, merged, aiArbitration }
//   event._mergeDecisions      [{ field, existingValue, newValue, chosenValue,
//                                 reason, source: 'ai'|'fallback' }]
//   event.mergeDecisions       same record shape from cross-parser merges,
//                              where present
// Missing/partial data must render a graceful note — never throw. The click
// handler for the export button (exportProvenanceIssue) is page JS defined by
// the adapter's generateRichHTML script block, not by this module.
//
// Consumed by:
//   - scripts/adapters/scriptable-adapter.js (event cards in the results and
//     saved-run WebView displays; display-saved-run.js renders via the adapter)
//   - scripts/event-provenance.test.js (headless Node tests)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

// Fields worth tracing. Everything else is either internal (_-prefixed) or
// derived (notes, gmaps) and is covered by the raw-JSON view instead.
const PROVENANCE_FIELDS = [
    'title', 'bar', 'address', 'location', 'city', 'startDate', 'endDate',
    'description', 'ticketUrl', 'website', 'image', 'cover'
];

const VALUE_PREVIEW_MAX = 80;

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Empty-ish values (null/undefined/blank) all render as the same missing marker.
function isMissingValue(value) {
    return value === null || value === undefined
        || (typeof value === 'string' && value.trim() === '');
}

// Render any field value as plain display text — objects/Dates/functions must
// never leak raw into HTML or comparisons.
function formatValueText(value) {
    if (isMissingValue(value)) return '';
    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString() : '';
    }
    if (typeof value === 'function') return '[function]';
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }
    return String(value);
}

function truncateText(text, maxLength = VALUE_PREVIEW_MAX) {
    const str = String(text || '');
    if (str.length <= maxLength) return str;
    return `${str.slice(0, maxLength - 1)}…`;
}

// Field-aware equality: date fields compare by instant so a saved run's ISO
// string equals the live Date object it was serialized from.
function valuesEqual(fieldName, a, b) {
    const aText = formatValueText(a);
    const bText = formatValueText(b);
    if (aText === bText) return true;
    if (fieldName === 'startDate' || fieldName === 'endDate') {
        const aMs = Date.parse(aText);
        const bMs = Date.parse(bText);
        if (Number.isFinite(aMs) && Number.isFinite(bMs)) return aMs === bMs;
    }
    return false;
}

// Recorded merge decisions keyed by field. _mergeDecisions (calendar-merge AI
// arbitration records) is preferred; cross-parser mergeDecisions records are
// folded in where present. Malformed entries are skipped, never thrown on.
function collectDecisionsByField(event) {
    const byField = {};
    const lists = [];
    if (event && Array.isArray(event._mergeDecisions)) lists.push(event._mergeDecisions);
    if (event && Array.isArray(event.mergeDecisions)) lists.push(event.mergeDecisions);
    for (const list of lists) {
        for (const decision of list) {
            if (!decision || typeof decision !== 'object') continue;
            if (typeof decision.field !== 'string' || !decision.field) continue;
            if (!byField[decision.field]) byField[decision.field] = [];
            byField[decision.field].push(decision);
        }
    }
    return byField;
}

// Human text for one recorded decision ({reason, source} record shape).
function formatDecisionText(decision) {
    if (!decision || typeof decision !== 'object') return '';
    const reason = typeof decision.reason === 'string' ? decision.reason.trim() : '';
    if (decision.source === 'ai') {
        return reason ? `AI: ${reason}` : 'AI arbitration';
    }
    if (decision.source === 'fallback') {
        return reason ? `AI fallback: ${reason}` : 'AI unavailable — fallback';
    }
    return reason || 'decision recorded';
}

// Derived decision text when values differ but no decision record exists
// (e.g. plain clobber/upsert paths that never log a record).
function deriveDecisionText(fieldName, finalValue, scraperValue, calendarValue, hasScraper, hasCalendar) {
    const matchesScraper = hasScraper && !isMissingValue(scraperValue)
        && valuesEqual(fieldName, finalValue, scraperValue);
    const matchesCalendar = hasCalendar && !isMissingValue(calendarValue)
        && valuesEqual(fieldName, finalValue, calendarValue);
    if (matchesScraper && matchesCalendar) return 'both sources agree';
    if (matchesScraper) {
        return hasCalendar && isMissingValue(calendarValue)
            ? 'took scraped value (calendar had none)'
            : 'took scraped value';
    }
    if (matchesCalendar) {
        return hasScraper && isMissingValue(scraperValue)
            ? 'kept from calendar (scrape found none)'
            : 'kept calendar value';
    }
    if (isMissingValue(finalValue)) return 'dropped during merge';
    return 'value derived during merge';
}

// Short "AI arbitration: N arbitrated, M fallback" summary from
// _original.aiArbitration { arbitrated: [fields], fallbacks: [fields] }.
function formatArbitrationSummary(aiArbitration) {
    if (!aiArbitration || typeof aiArbitration !== 'object') return '';
    const arbitrated = Array.isArray(aiArbitration.arbitrated) ? aiArbitration.arbitrated.length : 0;
    const fallbacks = Array.isArray(aiArbitration.fallbacks) ? aiArbitration.fallbacks.length : 0;
    if (arbitrated === 0 && fallbacks === 0) return '';
    const parts = [];
    if (arbitrated > 0) parts.push(`${arbitrated} arbitrated`);
    if (fallbacks > 0) parts.push(`${fallbacks} fallback${fallbacks === 1 ? '' : 's'}`);
    return `AI arbitration: ${parts.join(', ')}`;
}

// Structured provenance model for one analyzed event — everything the HTML
// builder and the export payload need, with no HTML in it. Never throws on
// missing/partial data.
function buildProvenanceModel(event, options = {}) {
    const safeEvent = event && typeof event === 'object' ? event : {};
    const original = safeEvent._original && typeof safeEvent._original === 'object'
        ? safeEvent._original
        : null;
    const scraper = original && original.scraper && typeof original.scraper === 'object'
        ? original.scraper
        : null;
    const calendar = original && original.calendar && typeof original.calendar === 'object'
        ? original.calendar
        : null;
    const decisionsByField = collectDecisionsByField(safeEvent);
    const hasDecisions = Object.keys(decisionsByField).length > 0;

    const parserConfig = safeEvent._parserConfig && typeof safeEvent._parserConfig === 'object'
        ? safeEvent._parserConfig
        : null;
    const parser = formatValueText(
        options.parser || safeEvent.source || (parserConfig && (parserConfig.name || parserConfig.parser)) || ''
    );
    const sourceUrl = formatValueText(
        safeEvent.url || safeEvent.website
        || (scraper && (scraper.url || scraper.website)) || ''
    );
    const action = formatValueText(options.action || safeEvent._action || '');

    const rows = [];
    let unchangedCount = 0;
    for (const field of PROVENANCE_FIELDS) {
        const finalValue = safeEvent[field];
        const scraperValue = scraper ? scraper[field] : undefined;
        const calendarValue = calendar ? calendar[field] : undefined;
        const decisions = decisionsByField[field] || [];

        const allMissing = isMissingValue(finalValue)
            && isMissingValue(scraperValue)
            && isMissingValue(calendarValue);
        if (allMissing && decisions.length === 0) continue;

        const differs = (scraper && !valuesEqual(field, finalValue, scraperValue))
            || (calendar && !valuesEqual(field, finalValue, calendarValue))
            || (scraper && calendar && !valuesEqual(field, scraperValue, calendarValue));

        if (!differs && decisions.length === 0) {
            unchangedCount += 1;
            continue;
        }

        const decisionText = decisions.length > 0
            ? decisions.map(formatDecisionText).filter(Boolean).join('; ')
            : deriveDecisionText(field, finalValue, scraperValue, calendarValue, Boolean(scraper), Boolean(calendar));

        rows.push({
            field,
            finalValue,
            scraperValue,
            calendarValue,
            decisionText,
            recorded: decisions.length > 0
        });
    }

    return {
        parser,
        sourceUrl,
        action,
        hasScraper: Boolean(scraper),
        hasCalendar: Boolean(calendar),
        // Whether any provenance data exists at all (vs. a bare final event
        // from a new action or an old saved run)
        hasProvenance: Boolean(scraper || calendar || hasDecisions),
        arbitrationSummary: formatArbitrationSummary(original ? original.aiArbitration : null),
        rows,
        unchangedCount
    };
}

// JSON-safe export payload for one event: everything a debugging session needs
// to reproduce a field decision, and nothing internal beyond the listed keys.
// Guaranteed serializable — functions and circular references are dropped.
function buildExportIssuePayload(event, options = {}) {
    const safeEvent = event && typeof event === 'object' ? event : {};
    const model = buildProvenanceModel(safeEvent, options);
    const original = safeEvent._original && typeof safeEvent._original === 'object'
        ? safeEvent._original
        : null;

    // Deep-clone one field value into a JSON-safe form: functions dropped,
    // Dates as ISO strings, circular references cut. Each value gets its own
    // seen-set so shared references across payload sections survive intact.
    const toJsonSafeValue = (value) => {
        if (value === undefined || typeof value === 'function') return undefined;
        if (value instanceof Date) return formatValueText(value) || null;
        if (value === null || typeof value !== 'object') return value;
        const seen = new WeakSet();
        try {
            return JSON.parse(JSON.stringify(value, (key, val) => {
                if (typeof val === 'function') return undefined;
                if (val && typeof val === 'object') {
                    if (seen.has(val)) return undefined;
                    seen.add(val);
                }
                return val;
            }));
        } catch (error) {
            return formatValueText(value);
        }
    };

    const pickFields = (source) => {
        if (!source || typeof source !== 'object') return null;
        const out = {};
        for (const field of PROVENANCE_FIELDS) {
            const value = toJsonSafeValue(source[field]);
            if (value === undefined) continue;
            out[field] = value;
        }
        return out;
    };

    const decisions = []
        .concat(Array.isArray(safeEvent._mergeDecisions) ? safeEvent._mergeDecisions : [])
        .concat(Array.isArray(safeEvent.mergeDecisions) ? safeEvent.mergeDecisions : [])
        .filter((decision) => decision && typeof decision === 'object')
        .map((decision) => ({
            field: decision.field || null,
            existingValue: formatValueText(decision.existingValue) || null,
            newValue: formatValueText(decision.newValue) || null,
            chosenValue: formatValueText(decision.chosenValue) || null,
            reason: decision.reason || null,
            source: decision.source || null
        }));

    const payload = {
        runId: options.runId || null,
        timestamp: options.timestamp || null,
        parser: model.parser || null,
        sourceUrl: model.sourceUrl || null,
        action: model.action || null,
        finalValues: pickFields(safeEvent) || {},
        scraperValues: pickFields(original ? original.scraper : null),
        calendarValues: pickFields(original ? original.calendar : null),
        mergeDecisions: decisions,
        aiArbitration: original && original.aiArbitration && typeof original.aiArbitration === 'object'
            ? {
                arbitrated: Array.isArray(original.aiArbitration.arbitrated) ? original.aiArbitration.arbitrated : [],
                fallbacks: Array.isArray(original.aiArbitration.fallbacks) ? original.aiArbitration.fallbacks : []
            }
            : null
    };

    // Round-trip through JSON with a defensive replacer so the result is
    // always serializable (functions dropped, circular references cut).
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(payload, (key, value) => {
        if (typeof value === 'function') return undefined;
        if (value && typeof value === 'object') {
            if (seen.has(value)) return undefined;
            seen.add(value);
        }
        return value;
    }));
}

// Pretty-printed JSON string of the export payload (what lands in the
// clipboard / textarea). Never throws — falls back to an error stub.
function buildExportIssueJson(event, options = {}) {
    try {
        return JSON.stringify(buildExportIssuePayload(event, options), null, 2);
    } catch (error) {
        return JSON.stringify({ error: `Failed to build export payload: ${error.message}` }, null, 2);
    }
}

// Same payload, no indentation — for embedding in the data-payload attribute
// ONLY. That attribute is percent-encoded, and percent-encoding charges 3
// bytes for every indent space (`%20`), so indent-2 was the single largest
// item left on the results page after the 2026-08-03 size fix: 240 KB of a
// 1462 KB page. The page-side handler re-indents before showing the textarea,
// so what the owner copies is unchanged. buildExportIssueJson stays pretty —
// it is the exported, tested serialization.
function buildExportIssueCompactJson(event, options = {}) {
    try {
        return JSON.stringify(buildExportIssuePayload(event, options));
    } catch (error) {
        return JSON.stringify({ error: `Failed to build export payload: ${error.message}` });
    }
}

// One value cell: truncated preview with the full value in title= for long
// values, missing values as an em dash.
function buildValueCellHtml(value) {
    const text = formatValueText(value);
    if (!text) {
        return '<td class="provenance-missing">—</td>';
    }
    const preview = truncateText(text);
    const titleAttr = preview === text ? '' : ` title="${escapeHtml(text)}"`;
    return `<td${titleAttr}>${escapeHtml(preview)}</td>`;
}

// The "📤 Export issue" control: button + hidden readonly textarea. The
// data-payload attribute carries the URI-encoded JSON; the page-side
// exportProvenanceIssue() handler (defined by the display's script block)
// reveals the textarea, selects it and attempts document.execCommand('copy').
function buildExportControlsHtml(event, options = {}) {
    const encoded = encodeURIComponent(buildExportIssueCompactJson(event, options));
    return `
            <div class="provenance-export">
                <button type="button" class="provenance-export-btn" onclick="exportProvenanceIssue(this)" data-payload="${escapeHtml(encoded)}">📤 Export issue</button>
                <div class="provenance-export-area" style="display: none;">
                    <textarea class="provenance-export-text" readonly rows="10" spellcheck="false" onfocus="this.select()"></textarea>
                    <div class="provenance-export-status"></div>
                </div>
            </div>`;
}

// Full collapsed "🔍 Provenance" <details> section for one event card.
// options: { action, parser, runId, timestamp } — all optional overrides the
// adapter passes through (action from its intent normalization, run info for
// the export payload). Degrades to an informative note on missing data.
function buildEventProvenanceSectionHtml(event, options = {}) {
    const model = buildProvenanceModel(event, options);

    const metaParts = [];
    if (model.parser) metaParts.push(`Parser: ${model.parser}`);
    if (model.action) metaParts.push(`Action: ${model.action}`);
    if (model.arbitrationSummary) metaParts.push(model.arbitrationSummary);
    const metaLine = metaParts.length > 0
        ? `<div class="provenance-meta">${escapeHtml(metaParts.join(' • '))}</div>`
        : '';
    const urlLine = model.sourceUrl
        ? `<div class="provenance-meta provenance-url" title="${escapeHtml(model.sourceUrl)}">Source: ${escapeHtml(truncateText(model.sourceUrl))}</div>`
        : '';

    let body;
    if (!model.hasProvenance) {
        body = '<div class="provenance-note">No provenance recorded for this event (new event or older saved run).</div>';
    } else if (model.rows.length === 0) {
        body = `<div class="provenance-note">All ${model.unchangedCount} tracked field${model.unchangedCount === 1 ? '' : 's'} passed through unchanged.</div>`;
    } else {
        const calendarHeader = model.hasCalendar ? '<th>Calendar</th>' : '';
        const rowsHtml = model.rows.map((row) => `
                    <tr>
                        <td class="provenance-field">${escapeHtml(row.field)}</td>
                        ${buildValueCellHtml(row.finalValue)}
                        ${buildValueCellHtml(row.scraperValue)}
                        ${model.hasCalendar ? buildValueCellHtml(row.calendarValue) : ''}
                        <td class="provenance-decision">${escapeHtml(row.decisionText)}</td>
                    </tr>`).join('');
        const unchangedNote = model.unchangedCount > 0
            ? `<div class="provenance-note">${model.unchangedCount} field${model.unchangedCount === 1 ? '' : 's'} unchanged</div>`
            : '';
        body = `
            <div class="provenance-table-wrap">
                <table class="provenance-table">
                    <tr><th>Field</th><th>Final</th><th>Scraper</th>${calendarHeader}<th>Decision</th></tr>
                    ${rowsHtml}
                </table>
            </div>
            ${unchangedNote}`;
    }

    return `
        <details class="provenance-details">
            <summary>🔍 Provenance</summary>
            ${metaLine}
            ${urlLine}
            ${body}
            ${buildExportControlsHtml(event, options)}
        </details>`;
}

const EventProvenance = {
    PROVENANCE_FIELDS,
    escapeHtml,
    formatValueText,
    valuesEqual,
    formatDecisionText,
    buildProvenanceModel,
    buildExportIssuePayload,
    buildExportIssueJson,
    buildExportIssueCompactJson,
    buildEventProvenanceSectionHtml
};

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EventProvenance,
        escapeHtml,
        formatValueText,
        valuesEqual,
        formatDecisionText,
        buildProvenanceModel,
        buildExportIssuePayload,
        buildExportIssueJson,
    buildExportIssueCompactJson,
        buildEventProvenanceSectionHtml
    };
} else if (typeof window !== 'undefined') {
    window.EventProvenance = EventProvenance;
} else {
    // Scriptable environment
    this.EventProvenance = EventProvenance;
}

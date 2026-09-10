// ============================================================================
// SOURCE EXPECTATIONS — COVERAGE + SCHEMA TEST
// ============================================================================
// data/source-expectations/<slug>.json is hand-written ground truth: what each
// scraped source SHOULD yield, read off the live site. One file per live parser
// in scripts/scraper-input.js — no exceptions, no silent partial coverage.
//
// 🚨 THE POINT OF THIS TEST IS THAT INCOMPLETENESS CANNOT BE QUIET.
// Every previous attempt at this documented two sources and stopped. So:
//   • a missing file is RED, so incompleteness can only take the form of a
//     visible status, never an absent file;
//   • a file left at "not-started" is RED (see: no source is left undocumented);
//   • the ledger prints all 22 statuses on every run, so "7/22" is visible
//     rather than inferable.
//
// It does NOT diff expectations against real runs — that tool comes later and
// reads ~/…/chunky-dad-scraper/runs/<runId>.json, comparing expect.extracted
// against parserResults[].events[] ∪ bearDroppedEvents[].
//
// 📖 READ data/source-expectations/README.md for what each field MEANS.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parsers } = require('./scraper-input');
const cities = require('./scraper-cities');
const { EventSchema } = require('./event-schema');
const { SharedCore } = require('./shared-core');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'source-expectations');
const SELF = 'scripts/source-expectations.test.js';

// A source is DONE when it reaches one of these. "not-started" and "in-progress"
// are working states — the sweep is not finished while any file sits in one.
const TERMINAL = ['complete', 'publishes-nothing', 'unreachable'];
const STATUSES = ['not-started', 'in-progress', ...TERMINAL];

const RECON_METHODS = ['feed', 'static', 'rendered', 'page-cache', 'classification-cache', 'flyer'];
const DOOR_ROLES = ['feed', 'listing', 'event', 'sitemap', 'search', 'flyer', 'other'];
const CONFIDENCE = ['high', 'medium', 'low'];
const EVENT_CONFIDENCE = ['high', 'ambiguous'];
const SOURCE_RUNGS = RECON_METHODS;
const TRAP_KINDS = ['venue-header', 'past-event', 'foreign-promoter', 'foreign-programming',
    'navigation', 'recurring-blurb', 'ticket-tier', 'merch', 'announcement',
    'duplicate-listing', 'soft-404', 'gallery', 'out-of-config-scope'];

// Event-data fields an expectation may carry. Every name here is a CANONICAL
// event-schema key — proven below — which is what makes the later run-diff a
// straight key-for-key comparison instead of an alias-mapping exercise.
const EVENT_DATA_FIELDS = ['title', 'shortName', 'description', 'bar', 'address', 'location',
    'city', 'timezone', 'startDate', 'startTime', 'endDate', 'endTime', 'recurrence',
    'website', 'ticketUrl', 'instagram', 'facebook', 'gmaps', 'image', 'cover'];
const EVENT_META_FIELDS = ['id', 'kind', 'recurrenceStatedAs', 'evidence', 'expect', 'bearVerdict',
    'sameEventAs', 'belongsToSource', 'sourceRung', 'confidence', 'occurrences', 'note'];
const INHERITABLE = ['city', 'timezone', 'bar', 'address', 'location', 'website', 'instagram', 'facebook'];
const OCCURRENCE_FIELDS = ['startDate', 'origin', 'cancelled', 'overrides', 'evidence', 'note'];
const RRULE_KEYS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY',
    'BYMONTH', 'BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'WKST']);
const PLACEHOLDER = /\b(TODO|TBD|FIXME|XXX|PLACEHOLDER|LOREM|FILL ?ME)\b/i;

const slugify = (name) => String(name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const liveParsers = () => parsers.filter((p) => !p.template);

function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    // Round-trip kills 2026-02-30, which Date happily rolls into March.
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isTimeZone = (v) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true; } catch { return false; }
};

function walkStrings(node, visit, trail = '$') {
    if (typeof node === 'string') return visit(node, trail);
    if (Array.isArray(node)) return node.forEach((v, i) => walkStrings(v, visit, `${trail}[${i}]`));
    if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walkStrings(v, visit, `${trail}.${k}`);
    }
}

function loadFiles() {
    return fs.readdirSync(DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => ({
            file: f,
            stem: f.slice(0, -5),
            doc: JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
        }));
}
const started = (doc) => doc.status !== 'not-started';
const eachFile = (fn) => loadFiles().forEach(({ file, stem, doc }) => fn(doc, file, stem));

// ── 1. The set of files IS the set of live sources ──────────────────────────
test('every live parser has an expectations file, and every file has a live parser', () => {
    const live = liveParsers();
    // Floor guards against the template filter (or scraper-input itself) silently
    // matching nothing and making this whole suite pass vacuously.
    assert.ok(live.length >= 22, `expected at least 22 live parsers, found ${live.length}`);

    const expected = new Map(live.map((p) => [slugify(p.name), p.name]));
    const actual = new Set(loadFiles().map((f) => f.stem));

    const missing = [...expected].filter(([slug]) => !actual.has(slug));
    assert.deepEqual(missing.map(([s]) => s), [],
        `sources with no expectations file (commit a not-started stub): ${missing
            .map(([slug, name]) => `${name} → data/source-expectations/${slug}.json`).join(', ')}`);

    const orphans = [...actual].filter((slug) => !expected.has(slug));
    assert.deepEqual(orphans, [],
        `expectations files with no live parser (renamed or deleted in scraper-input.js): ${orphans.join(', ')}`);

    for (const p of parsers.filter((x) => x.template)) {
        assert.ok(!actual.has(slugify(p.name)), `template entry "${p.name}" must not have an expectations file`);
    }
});

// ── 2. Identity: filename === slug === slugify(source) ──────────────────────
test('filename, slug, and source agree, and source names a live parser exactly', () => {
    const names = new Set(liveParsers().map((p) => p.name));
    eachFile((doc, file, stem) => {
        assert.equal(doc.schemaVersion, 1, `${file}: schemaVersion must be 1`);
        assert.ok(isText(doc.source), `${file}: source must be the exact parsers[].name`);
        assert.ok(names.has(doc.source), `${file}: source "${doc.source}" is not a live parser name`);
        assert.equal(doc.slug, slugify(doc.source), `${file}: slug must be slugify(source)`);
        assert.equal(stem, doc.slug, `${file}: filename stem must equal slug`);
    });
});

// ── 3. Shape, status enum, no placeholder prose ─────────────────────────────
test('top-level shape is valid and no placeholder text survives', () => {
    const allowed = new Set(['schemaVersion', 'source', 'slug', 'status', 'recon', 'defaults',
        'coverage', 'events', 'traps', 'openQuestions', 'recheckAfter']);
    eachFile((doc, file) => {
        for (const key of Object.keys(doc)) {
            assert.ok(allowed.has(key), `${file}: unknown top-level key "${key}"`);
        }
        assert.ok(STATUSES.includes(doc.status), `${file}: status "${doc.status}" not in ${STATUSES.join('|')}`);
        for (const arr of ['events', 'traps', 'openQuestions']) {
            assert.ok(Array.isArray(doc[arr]), `${file}: ${arr} must be an array`);
        }
        // Unknowns are null, never prose. This is what stops a half-finished file
        // from reading as finished.
        walkStrings(doc, (value, at) => {
            assert.ok(!PLACEHOLDER.test(value), `${file}: placeholder text at ${at} — use null, not "${value}"`);
        });
    });
});

// ── 4. Recon provenance matches the claimed status ──────────────────────────
test('recon metadata is complete enough for the claimed status', () => {
    const byName = new Map(liveParsers().map((p) => [p.name, p]));
    eachFile((doc, file) => {
        const r = doc.recon;
        assert.ok(r && typeof r === 'object', `${file}: recon block required`);
        if (!started(doc)) {
            assert.equal(r.date, null, `${file}: not-started must have recon.date null`);
            assert.deepEqual(doc.events, [], `${file}: not-started must have no events`);
            assert.deepEqual(doc.traps, [], `${file}: not-started must have no traps`);
            return;
        }
        assert.ok(isDate(r.date), `${file}: recon.date must be YYYY-MM-DD once recon has begun`);
        assert.ok(Array.isArray(r.method) && r.method.length > 0, `${file}: recon.method required`);
        for (const m of r.method) assert.ok(RECON_METHODS.includes(m), `${file}: bad recon.method "${m}"`);
        assert.ok(Array.isArray(r.doors) && r.doors.length > 0,
            `${file}: recon.doors must record what was actually read`);
        for (const d of r.doors) {
            assert.ok(isText(d.url), `${file}: every door needs a url`);
            assert.ok(DOOR_ROLES.includes(d.role), `${file}: door role "${d.role}" invalid`);
        }
        assert.ok(Array.isArray(r.parserUrlsAtRecon) && r.parserUrlsAtRecon.length > 0,
            `${file}: recon.parserUrlsAtRecon must snapshot scraper-input urls[] on the recon date`);
        // A finished file must describe the door the scraper actually uses today.
        // Parsers get repointed constantly (see the Dallas Eagle / Eagle LA notes).
        if (TERMINAL.includes(doc.status)) {
            assert.deepEqual(r.parserUrlsAtRecon, byName.get(doc.source).urls,
                `${file}: scraper-input.js repointed "${doc.source}" since recon — re-verify against the new urls `
                + `and update recon.parserUrlsAtRecon, or drop the file back to "in-progress"`);
        }
    });
});

// ── 5. Coverage counts reconcile with reality ───────────────────────────────
test('coverage counts reconcile and confidence is honest', () => {
    eachFile((doc, file) => {
        const c = doc.coverage;
        assert.ok(c && typeof c === 'object', `${file}: coverage block required`);
        assert.equal(c.documentedEventCount, doc.events.length,
            `${file}: documentedEventCount (${c.documentedEventCount}) must equal events.length (${doc.events.length})`);
        assert.ok(Array.isArray(c.knownGaps), `${file}: coverage.knownGaps must be an array`);
        if (!started(doc)) return;

        assert.ok(CONFIDENCE.includes(c.confidence), `${file}: coverage.confidence "${c.confidence}" invalid`);
        assert.ok(isText(c.basis), `${file}: coverage.basis must say HOW coverage was established`);
        assert.equal(typeof c.publishedEventCount, 'number', `${file}: publishedEventCount must be a number`);

        if (doc.status === 'in-progress') {
            assert.ok(c.knownGaps.length > 0, `${file}: in-progress must name what is still missing in coverage.knownGaps`);
        }
        if (doc.status === 'publishes-nothing') {
            assert.equal(c.publishedEventCount, 0, `${file}: publishes-nothing means publishedEventCount 0`);
            assert.deepEqual(doc.events, [], `${file}: publishes-nothing means no events`);
            // A confirmed zero needs a positive empty-state citation from two doors.
            assert.ok(doc.recon.doors.length >= 2,
                `${file}: publishes-nothing needs TWO independent doors agreeing the site is empty`);
        }
        if (doc.status === 'unreachable') {
            assert.ok(c.knownGaps.length > 0, `${file}: unreachable must explain which rung failed, in coverage.knownGaps`);
        }
        if (doc.status === 'complete') {
            assert.notEqual(c.confidence, 'low',
                `${file}: a "complete" file cannot have low confidence — it is in-progress`);
            assert.equal(c.publishedEventCount, doc.events.length,
                `${file}: complete means every published event is documented `
                + `(${c.publishedEventCount} published vs ${doc.events.length} documented)`);
            assert.ok(c.occurrenceWindow && isDate(c.occurrenceWindow.start) && isDate(c.occurrenceWindow.end),
                `${file}: complete needs coverage.occurrenceWindow`);
        }
    });
});

// ── 6. Defaults speak the codebase's vocabulary ─────────────────────────────
test('defaults use canonical city keys, valid IANA timezones, and inheritable fields only', () => {
    const cityKeys = new Set(Object.keys(cities));
    eachFile((doc, file) => {
        const d = doc.defaults || {};
        for (const key of Object.keys(d)) {
            assert.ok(INHERITABLE.includes(key), `${file}: defaults.${key} is not inheritable (${INHERITABLE.join(', ')})`);
        }
        if (d.city !== undefined && d.city !== null) {
            assert.ok(cityKeys.has(d.city), `${file}: defaults.city "${d.city}" is not a key in scripts/scraper-cities.js`);
        }
        if (d.timezone !== undefined && d.timezone !== null) {
            assert.ok(isTimeZone(d.timezone), `${file}: defaults.timezone "${d.timezone}" is not a valid IANA zone`);
        }
    });
});

// ── 7. Field vocabulary IS the canonical event vocabulary ───────────────────
test('expectation event fields are canonical event-schema keys', () => {
    // Meta-assertion: if event-schema renames a canonical field, this goes red and
    // tells you the expectations vocabulary needs updating too.
    for (const field of EVENT_DATA_FIELDS) {
        assert.equal(EventSchema.canonicalizeEventKey(field), field,
            `"${field}" is not a canonical event key — expectations must use the canonical spelling`);
    }
    const allowed = new Set([...EVENT_DATA_FIELDS, ...EVENT_META_FIELDS]);
    eachFile((doc, file) => {
        for (const event of doc.events) {
            for (const key of Object.keys(event)) {
                assert.ok(allowed.has(key),
                    `${file}#${event.id}: unknown field "${key}" (canonical form: "${EventSchema.canonicalizeEventKey(key)}")`);
            }
        }
    });
});

// ── 8. Event bodies parse ───────────────────────────────────────────────────
test('events parse: ids unique, dates real, times 24h, location is coordinates or null', () => {
    const core = new SharedCore(cities, { eventSchema: EventSchema });
    const cityKeys = new Set(Object.keys(cities));
    eachFile((doc, file) => {
        const ids = new Set();
        for (const event of doc.events) {
            const where = `${file}#${event.id}`;
            assert.ok(isText(event.id) && /^[a-z0-9-]+$/.test(event.id), `${file}: event id "${event.id}" must be kebab-case`);
            assert.ok(!ids.has(event.id), `${file}: duplicate event id "${event.id}"`);
            ids.add(event.id);
            assert.ok(['series', 'single'].includes(event.kind), `${where}: kind must be series|single`);
            assert.ok(isText(event.title), `${where}: title required`);
            assert.ok(SOURCE_RUNGS.includes(event.sourceRung), `${where}: sourceRung "${event.sourceRung}" invalid`);
            assert.ok(EVENT_CONFIDENCE.includes(event.confidence), `${where}: confidence must be high|ambiguous`);

            for (const f of ['startDate', 'endDate']) {
                if (event[f] === undefined || event[f] === null) continue;
                assert.ok(isDate(event[f]), `${where}: ${f} "${event[f]}" must be a real YYYY-MM-DD`);
            }
            for (const f of ['startTime', 'endTime']) {
                if (event[f] === undefined || event[f] === null) continue;
                assert.ok(isTime(event[f]), `${where}: ${f} "${event[f]}" must be HH:MM 24-hour`);
            }
            if (event.city !== undefined && event.city !== null) {
                assert.ok(cityKeys.has(event.city), `${where}: city "${event.city}" is not a scraper-cities key`);
            }
            if (event.timezone !== undefined && event.timezone !== null) {
                assert.ok(isTimeZone(event.timezone), `${where}: timezone "${event.timezone}" invalid`);
            }
            // Calendar contract: location is ALWAYS coordinates, never an address.
            if (event.location !== undefined && event.location !== null) {
                assert.ok(core.isCoordinatePair(event.location),
                    `${where}: location "${event.location}" must be a "lat, lng" pair — addresses go in address`);
            }
            if (event.kind === 'single') {
                assert.ok(isDate(event.startDate), `${where}: a single needs a startDate`);
                assert.ok(event.occurrences === undefined, `${where}: singles have no occurrences`);
            }
            assertExpect(event, where);
            assertEvidence(event.evidence, where);
            assertBearVerdict(event.bearVerdict, where);
        }
    });
});

// ── 9. Series carry a quotable rule and materialized occurrences ────────────
test('series carry a quotable RRULE and occurrences inside the window', () => {
    eachFile((doc, file) => {
        const window = doc.coverage && doc.coverage.occurrenceWindow;
        for (const event of doc.events.filter((e) => e.kind === 'series')) {
            const where = `${file}#${event.id}`;
            assert.ok(isText(event.recurrence), `${where}: a series needs a recurrence`);
            assert.ok(!/^RRULE:/i.test(event.recurrence), `${where}: recurrence is the RRULE VALUE only, no "RRULE:" prefix`);
            assert.ok(event.recurrence.startsWith('FREQ='), `${where}: recurrence must start with FREQ=`);
            for (const part of event.recurrence.split(';')) {
                const [key, value] = part.split('=');
                assert.ok(RRULE_KEYS.has(key) && isText(value), `${where}: bad RRULE part "${part}"`);
            }
            // AI_PROMPT_FIELDS forbids inferring recurrence from vague words; ground
            // truth is held to the same bar — you must be able to quote the site.
            assert.ok(isText(event.recurrenceStatedAs),
                `${where}: recurrenceStatedAs must quote the site text that states the repeat`);

            const occ = event.occurrences;
            assert.ok(Array.isArray(occ) && occ.length > 0, `${where}: a series needs concrete occurrences`);
            let previous = null;
            const seen = new Set();
            for (const o of occ) {
                for (const key of Object.keys(o)) {
                    assert.ok(OCCURRENCE_FIELDS.includes(key), `${where}: unknown occurrence field "${key}"`);
                }
                assert.ok(isDate(o.startDate), `${where}: occurrence startDate "${o.startDate}" must be a real date`);
                assert.ok(!seen.has(o.startDate), `${where}: duplicate occurrence ${o.startDate}`);
                seen.add(o.startDate);
                assert.ok(previous === null || previous < o.startDate, `${where}: occurrences must be sorted ascending`);
                previous = o.startDate;
                assert.ok(['listed', 'rule'].includes(o.origin), `${where}: occurrence origin must be listed|rule`);
                if (window) {
                    assert.ok(o.startDate >= window.start && o.startDate <= window.end,
                        `${where}: occurrence ${o.startDate} falls outside coverage.occurrenceWindow`);
                }
                // Every claim needs a pointer. A plain rule-derived date is not a claim.
                const isClaim = o.origin === 'listed' || o.cancelled === true || o.overrides !== undefined;
                if (isClaim) assertEvidence(o.evidence, `${where}@${o.startDate}`);
            }
        }
    });
});

// ── 10. Traps are evidence-backed and explain themselves ────────────────────
test('traps are evidence-backed and explain themselves', () => {
    eachFile((doc, file) => {
        const ids = new Set();
        for (const trap of doc.traps) {
            const where = `${file}!${trap.id}`;
            assert.ok(isText(trap.id) && !ids.has(trap.id), `${where}: trap id must be present and unique`);
            ids.add(trap.id);
            assert.ok(isText(trap.label), `${where}: trap needs a label (what it looks like on the page)`);
            assert.ok(TRAP_KINDS.includes(trap.kind), `${where}: trap kind "${trap.kind}" not in ${TRAP_KINDS.join('|')}`);
            assert.ok(isText(trap.why), `${where}: trap must explain WHY it is not a scrapable event`);
            assertEvidence(trap.evidence, where);
            assertExpect(trap, where);
            if (trap.seenInRun !== undefined && trap.seenInRun !== null) {
                assert.ok(/^\d{8}-\d{6}$/.test(trap.seenInRun), `${where}: seenInRun must be a runId like 20260909-072307`);
            }
        }
    });
});

// ── 11. Cross-file identity resolves ────────────────────────────────────────
test('sameEventAs references point at a real file and, when complete, a real event', () => {
    const files = loadFiles();
    const byStem = new Map(files.map((f) => [f.stem, f.doc]));
    for (const { file, doc } of files) {
        for (const event of doc.events) {
            for (const ref of event.sameEventAs || []) {
                const [slug, id] = String(ref).split('#');
                assert.ok(byStem.has(slug), `${file}#${event.id}: sameEventAs "${ref}" names unknown source "${slug}"`);
                const target = byStem.get(slug);
                if (target.status === 'complete') {
                    assert.ok(target.events.some((e) => e.id === id),
                        `${file}#${event.id}: sameEventAs "${ref}" — "${slug}" is complete but has no event "${id}"`);
                }
            }
        }
    }
});

// ── 12. THE GATE ────────────────────────────────────────────────────────────
// Red until every source is documented. This is the whole reason the file exists:
// the sweep has been abandoned partway more than once, and a red build is the
// only thing that makes "we did 2 of 22" impossible to ship.
test('no source is left undocumented', () => {
    const open = loadFiles()
        .filter(({ doc }) => !TERMINAL.includes(doc.status))
        .map(({ stem, doc }) => `${stem} (${doc.status})`);
    assert.deepEqual(open, [],
        `${open.length} of ${loadFiles().length} sources still need recon — `
        + `each must reach one of ${TERMINAL.join(' | ')}: ${open.join(', ')}`);
});

// ── 13. The progress megaphone: always green, always loud ───────────────────
test('source expectations ledger', (t) => {
    const files = loadFiles();
    const icons = {
        'complete': '✅', 'in-progress': '🚧', 'not-started': '⛔',
        'publishes-nothing': '🕳️', 'unreachable': '❓'
    };
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));

    for (const { stem, doc } of files) {
        counts[doc.status] += 1;
        const c = doc.coverage || {};
        const detail = doc.status === 'in-progress'
            ? ` — ${c.documentedEventCount}/${c.publishedEventCount} events documented`
            : doc.status === 'complete'
                ? ` — ${c.documentedEventCount} events, ${doc.traps.length} traps`
                : '';
        t.diagnostic(`  ${icons[doc.status]} ${stem.padEnd(20)} ${doc.status}${detail}`);
    }

    const done = files.filter(({ doc }) => TERMINAL.includes(doc.status)).length;
    t.diagnostic(`SOURCE EXPECTATIONS: ${done}/${files.length} documented `
        + `(${counts.complete} complete, ${counts['publishes-nothing']} publishing nothing, `
        + `${counts.unreachable} unreachable, ${counts['in-progress']} in progress, `
        + `${counts['not-started']} NOT STARTED)`);

    // Never fails — assertion 12 owns the red line. This one exists so the number
    // is on screen every single run.
    assert.equal(files.length, liveParsers().length);
});

// ── 14. Nothing is auto-discovered, so guard the registration itself ────────
test('every scripts test file is registered in the package.json test script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const registered = new Set(pkg.scripts.test.split(/\s+/).filter((token) => token.endsWith('.test.js')));
    assert.ok(registered.has(SELF), `${SELF} is not registered in package.json — it would never run`);

    const found = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.test.js')) found.push(path.relative(ROOT, full));
        }
    })(__dirname);

    const unregistered = found.filter((f) => !registered.has(f)).sort();
    assert.deepEqual(unregistered, [], `test files that exist but never run: ${unregistered.join(', ')}`);
});

// ── Shared sub-assertions ───────────────────────────────────────────────────
function assertEvidence(evidence, where) {
    assert.ok(evidence && typeof evidence === 'object', `${where}: evidence pointer required`);
    assert.ok(isText(evidence.url), `${where}: evidence.url required`);
    assert.ok(isText(evidence.quote) || isText(evidence.jsonPath),
        `${where}: evidence needs a verbatim quote or a jsonPath into the feed response`);
    if (evidence.imageUrl !== undefined && evidence.imageUrl !== null) {
        assert.ok(isText(evidence.imageUrl), `${where}: evidence.imageUrl must be a url when present`);
    }
}

function assertExpect(entry, where) {
    const e = entry.expect;
    assert.ok(e && typeof e === 'object', `${where}: expect block required`);
    assert.ok([true, false, 'unknown'].includes(e.extracted),
        `${where}: expect.extracted must be true|false|"unknown" `
        + `(does the run contain this record at all — kept OR bear-dropped?)`);
    if (e.kept !== undefined) {
        assert.ok([true, false, null].includes(e.kept),
            `${where}: expect.kept stays null until the bear-verdict pass`);
    }
    if (e.extracted === 'unknown') {
        assert.ok(isText(e.note), `${where}: expect.extracted "unknown" must explain what makes it uncertain`);
    }
}

function assertBearVerdict(verdict, where) {
    if (verdict === undefined || verdict === null) return; // deferred by design
    assert.ok([true, false, 'unsure'].includes(verdict.value), `${where}: bearVerdict.value must be true|false|"unsure"`);
    assert.ok(isText(verdict.decidedBy), `${where}: bearVerdict.decidedBy required`);
    assert.ok(isDate(verdict.decidedOn), `${where}: bearVerdict.decidedOn must be YYYY-MM-DD`);
}

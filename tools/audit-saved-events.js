#!/usr/bin/env node
'use strict';

// One-time audit of the events ALREADY on the calendars (Phase B, owner
// 2026-11-05: "revisit ALL existing events"): how do today's rules class
// every upcoming saved event — bear, kept for a tag, maybe, not bear?
//
// REPORT-ONLY. It reads the published calendars from this checkout
// (data/calendars/<city>.ics), one saved run and the verdict store, and
// prints numbers. It builds no card, writes nothing to the shared folder and
// touches no calendar; `--out` writes the party list to a file of the
// caller's choosing.
//
// Where each event's answer comes from, best evidence first:
//   run-kept     the run matched it and kept it — the source's own fresh
//                text passed the bear check;
//   run-dropped  the run read the same event at its source and the bear
//                check dropped it (matched to the saved record with the
//                calendar matcher the pipeline itself uses);
//   copy         nothing in the run matched it, so the calendar's own copy
//                (title + notes) is put through the same bear check, with the
//                source's config when its link points into one we read.
// The owner's own word outranks all three: a verdict in the store, or a
// manual stamp on the saved record.
//
// usage: node tools/audit-saved-events.js [--run <id>] [--city <key>] [--no-ai] [--out <file.json>]

const fs = require('fs');
const path = require('path');
const queue = require('./review-queue');
const eventShape = require('./event-shape');

const repoRoot = path.join(__dirname, '..');
const { SharedCore } = require(path.join(repoRoot, 'scripts', 'shared-core'));
const { EventSchema } = require(path.join(repoRoot, 'scripts', 'event-schema'));
const { WebAdapter } = require(path.join(repoRoot, 'scripts', 'adapters', 'web-adapter'));

const BAR_SCENES = ['bear', 'leather', 'adjacent'];

// The calendars as this checkout holds them: no network, no phone snapshot,
// and no shared storage root — nothing this adapter does can land in the
// phone's tree.
function createAuditAdapter(options = {}) {
    const calendarsDir = options.calendarsDir || path.join(repoRoot, 'data', 'calendars');
    class AuditAdapter extends WebAdapter {
        resolveSharedStorageRootSetting() { return ''; }
        async getPhoneCalendarSnapshot() { return null; }
        async getPublishedCalendarEvents(cityKey) {
            const key = String(cityKey || '').trim();
            if (!key) return null;
            if (!this._auditCalendars) this._auditCalendars = {};
            if (Object.prototype.hasOwnProperty.call(this._auditCalendars, key)) return this._auditCalendars[key];
            let entry = null;
            try {
                const filePath = path.join(calendarsDir, `${key}.ics`);
                if (fs.existsSync(filePath)) {
                    const records = SharedCore.parsePublishedCalendarIcs(fs.readFileSync(filePath, 'utf8'));
                    if (Array.isArray(records)) entry = { records, fetchedAt: fs.statSync(filePath).mtime.toISOString() };
                }
            } catch (error) {
                entry = null;
            }
            this._auditCalendars[key] = entry;
            return entry;
        }
    }
    return new AuditAdapter({ cities: options.cities || {} });
}

// Every upcoming saved record, a series folded to its next night.
async function readSavedInventory(adapter, cityKeys, now) {
    const savedByCity = await adapter.listSavedUpcomingEvents(cityKeys);
    const saved = [];
    for (const city of Object.keys(savedByCity).sort()) {
        const byUid = new Map();
        for (const event of savedByCity[city].events) {
            const startMs = SharedCore.toEpochMillis(event.startDate);
            const endMs = SharedCore.toEpochMillis(event.endDate);
            const lastMs = endMs !== null ? endMs : startMs;
            if (lastMs === null || lastMs < now) continue;
            const uid = event.uid || event.identifier;
            const known = byUid.get(uid);
            if (known) { known.nights += 1; continue; }
            byUid.set(uid, { ...event, uid, city, nights: 1 });
        }
        saved.push(...byUid.values());
    }
    return saved;
}

// The saved record as the pipeline's event shape: what the bear check, the
// verdict store and the curated-bar lookup read.
function savedRecordAsEvent(core, record) {
    const fields = core.parseNotesIntoFields(record.notes || '');
    const text = (value) => (typeof value === 'string' ? value.trim() : '');
    return {
        title: text(record.title),
        description: text(fields.description),
        bar: text(fields.bar),
        address: text(fields.address),
        city: record.city,
        startDate: record.startDate,
        endDate: record.endDate,
        timezone: text(fields.timezone) || core.getCityTimezone(record.city) || null,
        location: text(record.location),
        url: text(record.url) || text(fields.website) || text(fields.url),
        website: text(fields.website),
        ticketUrl: text(fields.ticketUrl),
        image: text(fields.image),
        key: text(fields.key)
    };
}

// uid → the analyzed event that merges into it (the run kept it).
function collectKeptEvidence(run) {
    const kept = new Map();
    for (const event of Array.isArray(run.analyzedEvents) ? run.analyzedEvents : []) {
        const identifier = event && event._existingEvent && typeof event._existingEvent === 'object' ? event._existingEvent.identifier : '';
        const uid = SharedCore.savedEventUid(identifier);
        if (uid && !kept.has(uid)) kept.set(uid, event);
    }
    return kept;
}

// A series is matched on the phone by its own identifier, which the
// published calendar does not carry; the run names the series it mapped an
// event onto (`_seriesMatch`: calendar + title), and that names it here.
function collectSeriesEvidence(core, run) {
    const kept = new Map();
    for (const event of Array.isArray(run.analyzedEvents) ? run.analyzedEvents : []) {
        const match = event && event._seriesMatch && typeof event._seriesMatch === 'object' ? event._seriesMatch : null;
        if (!match || !match.title) continue;
        const city = String(match.calendarName || '').replace(/^chunky-dad-/, '');
        const key = `${city}|${core.getBearVerdictTitleKey(match.title, []) || String(match.title).toLowerCase()}`;
        if (!kept.has(key)) kept.set(key, event);
    }
    return kept;
}

// uid → the dropped row whose event IS that saved record, by the pipeline's
// own calendar matcher (the wiring of prepareEventsForCalendar's rescue
// pass). A store-decided drop outranks a machine one for the same record.
async function matchDroppedToSaved(core, adapter, run, now) {
    const matches = new Map();
    for (const row of Array.isArray(run.bearDroppedEvents) ? run.bearDroppedEvents : []) {
        const event = row && row.event && typeof row.event === 'object' ? row.event : null;
        if (!event) continue;
        const startMs = SharedCore.toEpochMillis(event.startDate);
        const endMs = SharedCore.toEpochMillis(event.endDate);
        const lastMs = endMs !== null ? endMs : startMs;
        if (lastMs === null || lastMs < now) continue;
        const existing = core.viewStoredAllDayRecords(await adapter.getExistingEvents(event), event);
        const analysis = await core.resolveCalendarAnalysisWithSeriesProbe(event, existing, 'upsert', adapter);
        const record = analysis && (analysis.existingEvent || analysis.sourceEvent);
        if (!record || analysis.action === 'new') continue;
        const uid = SharedCore.savedEventUid(record.identifier || record.id);
        if (!uid) continue;
        const known = matches.get(uid);
        const ownerRuled = /^manual store:/.test(String(row.reason || ''));
        if (!known || (ownerRuled && !/^manual store:/.test(String(known.reason || '')))) matches.set(uid, row);
    }
    return matches;
}

// The source whose config the calendar copy is judged under: the one we
// read whose configured pages share a site with the record's own links.
// Aggregators point at other people's events and lend no trust.
function findSourceConfigForEvent(core, event, parserConfigs) {
    const domains = new Set(['url', 'website', 'ticketUrl']
        .map((field) => core.getRegistrableDomainFromUrl(event[field] || ''))
        .filter(Boolean));
    if (domains.size === 0) return null;
    for (const config of parserConfigs) {
        if (String(config.siteRole || '').trim().toLowerCase() === 'aggregator') continue;
        for (const url of Array.isArray(config.urls) ? config.urls : []) {
            const parts = core.getUrlRuleParts(url);
            if (!parts || !parts.host || core.isKnownTicketingPlatformHost(parts.host)) continue;
            if (domains.has(core.getRegistrableDomainFromUrl(url))) return config;
        }
    }
    return null;
}

// One saved record + its evidence → { class, ruledBy, tier, reason }.
//   class    bear | tagged | maybe | not-bear | review | unjudged
//   ruledBy  owner (the store or a manual stamp) | machine | rubric (a
//            machine not-bear at a bar the owner marked — his "maybe")
function classifySavedRecord(core, record, evidence) {
    const event = evidence.event;
    const stamp = core.getManualBearVerdictFromRecord(record);
    const dropReason = evidence.dropped ? String(evidence.dropped.reason || '') : '';
    const storeDrop = /^manual store:/.test(dropReason);
    if (storeDrop) {
        return /^manual store:\s*maybe/.test(dropReason)
            ? { class: 'maybe', ruledBy: 'owner', tier: 'store', reason: dropReason }
            : { class: 'not-bear', ruledBy: 'owner', tier: 'store', reason: dropReason };
    }
    if (evidence.kept) {
        const source = String(evidence.kept.bearSource || '').trim();
        const lower = source.toLowerCase();
        if (lower.startsWith('manual-bear')) return { class: 'bear', ruledBy: 'owner', tier: 'store', reason: source };
        if (lower.startsWith('manual-tagged')) return { class: 'tagged', ruledBy: 'owner', tier: 'store', reason: source };
        if (stamp === 'manual-not-bear') return { class: 'not-bear', ruledBy: 'owner', tier: 'stamp', reason: 'manual-not-bear on the saved record' };
        if (evidence.kept.bearReview) return { class: 'review', ruledBy: 'machine', tier: 'flagged', reason: String(evidence.kept.bearReview) };
        if (lower.startsWith('tagged')) return { class: 'tagged', ruledBy: 'machine', tier: /keyword/.test(lower) ? 'keyword' : 'ai', reason: source };
        if (stamp === 'manual-bear') return { class: 'bear', ruledBy: 'owner', tier: 'stamp', reason: 'manual-bear on the saved record' };
        if (stamp === 'manual-tagged') return { class: 'tagged', ruledBy: 'owner', tier: 'stamp', reason: 'manual-tagged on the saved record' };
        let tier = lower.split(/[\s:(]/)[0] || 'unstamped';
        if (tier === 'keyword') {
            // WHERE the bear word sits is the strength of a keyword answer:
            // the party's own name, the venue's name, or a bear brand named
            // in the description. Anything else passed on its source's trust.
            const read = evidence.kept;
            const where = core.classifyBearKeywordMatch(read, core.matchBearKeywords(`${read.title || ''} ${read.description || ''} ${read.bar || ''}`)).source;
            tier = where === 'title' || where === 'stated-title' ? 'keyword-title'
                : where === 'venue' ? 'keyword-venue'
                : where === 'description-brand' ? 'keyword-brand'
                : 'keyword-source';
        }
        return { class: 'bear', ruledBy: 'machine', tier, reason: source || 'kept, no bearSource' };
    }
    // A manual stamp on the saved record decides where the store is silent
    // (the pipeline's own demote and rescue passes).
    if (stamp === 'manual-not-bear') return { class: 'not-bear', ruledBy: 'owner', tier: 'stamp', reason: 'manual-not-bear on the saved record' };
    if (stamp === 'manual-bear') return { class: 'bear', ruledBy: 'owner', tier: 'stamp', reason: 'manual-bear on the saved record' };
    if (stamp === 'manual-tagged') return { class: 'tagged', ruledBy: 'owner', tier: 'stamp', reason: 'manual-tagged on the saved record' };
    if (evidence.dropped) {
        // The owner's rubric: a party at a bar he marked is a maybe, not a no.
        const cityBars = core.getCuratedCityBars(String(event.city || '').trim().toLowerCase());
        const bar = cityBars
            ? (core.findCuratedBarByName(cityBars, event.bar || '') || core.findCuratedBarByPlace(cityBars, event.location || '', event.address || ''))
            : null;
        const scene = bar && BAR_SCENES.includes(bar.scene) ? bar.scene : '';
        if (scene && !/^leather for another crowd/.test(dropReason)) {
            return { class: 'maybe', ruledBy: 'rubric', tier: `${scene}-bar`, reason: dropReason };
        }
        return { class: 'not-bear', ruledBy: 'machine', tier: /^ai/.test(dropReason) ? 'ai' : 'audience', reason: dropReason };
    }
    return { class: 'unjudged', ruledBy: 'machine', tier: 'none', reason: evidence.note || 'no evidence' };
}

function buildReport(core, judged, meta) {
    const parties = new Map();
    const evidenceRank = { 'run-kept': 0, 'run-dropped': 1, copy: 2, none: 3 };
    for (const item of judged) {
        const titleKey = core.getBearVerdictTitleKey(item.event.title, [item.event.bar]) || item.event.title.toLowerCase();
        const key = `${item.record.city}|${titleKey}|${core.getOwnerReviewPlaceKey(item.event)}|${item.record.series ? 'series' : 'single'}`;
        if (!parties.has(key)) parties.set(key, { key, city: item.record.city, title: item.event.title, bar: item.event.bar, series: item.record.series === true, members: [] });
        parties.get(key).members.push(item);
    }
    const partyRows = [];
    for (const party of parties.values()) {
        // The party answers as its best-evidenced night does.
        const lead = party.members.slice().sort((a, b) => (a.verdict.ruledBy === 'owner' ? -1 : 0) - (b.verdict.ruledBy === 'owner' ? -1 : 0)
            || evidenceRank[a.evidence] - evidenceRank[b.evidence])[0];
        const starts = party.members.map((member) => SharedCore.toEpochMillis(member.record.startDate)).filter((ms) => ms !== null).sort((a, b) => a - b);
        partyRows.push({
            key: party.key,
            city: party.city,
            title: party.title,
            bar: party.bar,
            series: party.series,
            class: lead.verdict.class,
            ruledBy: lead.verdict.ruledBy,
            tier: lead.verdict.tier,
            evidence: lead.evidence,
            reason: lead.verdict.reason,
            mixed: new Set(party.members.map((member) => member.verdict.class)).size > 1,
            events: party.members.length,
            nights: party.members.reduce((sum, member) => sum + member.record.nights, 0),
            next: starts.length > 0 ? new Date(starts[0]).toISOString() : null,
            uids: party.members.map((member) => member.record.uid)
        });
    }
    const tally = (rows, keyOf) => {
        const out = {};
        for (const row of rows) {
            const key = keyOf(row);
            if (!out[key]) out[key] = { events: 0, parties: 0 };
            out[key].events += row.events;
            out[key].parties += 1;
        }
        return out;
    };
    const singles = partyRows.filter((row) => !row.series);
    const series = partyRows.filter((row) => row.series);
    const lineOf = (row) => `${row.class} · ${row.ruledBy}`;
    return {
        ...meta,
        totals: {
            singles: { events: singles.reduce((sum, row) => sum + row.events, 0), parties: singles.length },
            series: { events: series.reduce((sum, row) => sum + row.events, 0), parties: series.length }
        },
        singles: tally(singles, lineOf),
        singlesByTier: tally(singles, (row) => `${lineOf(row)} · ${row.tier} · ${row.evidence}`),
        series: tally(series, lineOf),
        mixedParties: partyRows.filter((row) => row.mixed).length,
        parties: partyRows.sort((a, b) => lineOf(a).localeCompare(lineOf(b)) || a.city.localeCompare(b.city) || a.title.localeCompare(b.title))
    };
}

async function assertAiReachable(ai) {
    const endpoint = String((ai && ai.endpoint) || '');
    let status = 0;
    try {
        const response = await fetch(new URL('/v1/models', endpoint), { signal: AbortSignal.timeout(10000) });
        status = response.status;
    } catch (error) {
        status = 0;
    }
    if (status !== 200) throw new Error(`the AI server does not answer at ${endpoint || '(no endpoint)'} — start it, or pass --no-ai`);
}

async function runAudit(options = {}) {
    const sharedRoot = options.sharedRoot || queue.resolveSharedRoot();
    const runId = options.runId || queue.pickLatestRunId(sharedRoot);
    const loaded = runId ? queue.loadRun(sharedRoot, runId) : null;
    if (!loaded) throw new Error(`no saved run to read under ${sharedRoot}`);
    const run = loaded.payload;
    const now = options.now || Date.now();

    const bootstrap = new WebAdapter({});
    const config = await bootstrap.loadConfiguration();
    const core = new SharedCore(config.cities, {
        eventSchema: EventSchema,
        bars: config.bars || {},
        promoters: config.promoters || [],
        festivals: Array.isArray(config.festivals) ? config.festivals : []
    });
    core.bearVerdicts = queue.loadBearVerdicts(queue.getBearVerdictsPath(sharedRoot));
    // A re-ask reads each party's poster as a run does (SharedCore.
    // applyFlyerTextEvidence): the vision model's stored reading, nothing is
    // downloaded here.
    const flyerIndex = eventShape.getFlyerTextIndex(sharedRoot);
    core.setFlyerEvidenceLookup((imageUrl) => {
        const hit = flyerIndex.lookup(imageUrl);
        return hit && hit.text ? { text: hit.text, classification: hit.classification || '' } : null;
    });
    const adapter = createAuditAdapter({ cities: config.cities, calendarsDir: options.calendarsDir });
    const parserConfigs = (Array.isArray(config.parsers) ? config.parsers : []).map((parser) => core.resolveEffectiveParserConfig(parser, config));
    // Never the run's answer cache: an audit question is asked fresh and
    // leaves nothing behind.
    const globalAi = { ...((config.config && config.config.ai) || {}), cache: false };

    // No partial runs: an unreachable model would leave every unseen event
    // "unjudged" and the table would read as an answer.
    if (options.ai !== false) await assertAiReachable(globalAi);

    const cityKeys = options.city ? [options.city] : Object.keys(config.cities || {});
    const saved = await readSavedInventory(adapter, cityKeys, now);
    const kept = collectKeptEvidence(run);
    const keptSeries = collectSeriesEvidence(core, run);
    const dropped = await matchDroppedToSaved(core, adapter, run, now);

    // Records are re-asked one at a time; whether a poster is one party's
    // needs every saved record that carries it in view.
    core.noteFlyerCarriers(saved.map(record => savedRecordAsEvent(core, record)));

    const judged = [];
    let asked = 0;
    for (const record of saved) {
        const event = savedRecordAsEvent(core, record);
        const seriesKey = `${record.city}|${core.getBearVerdictTitleKey(record.title, []) || String(record.title || '').toLowerCase()}`;
        const evidence = { event, kept: kept.get(record.uid) || (record.series ? keptSeries.get(seriesKey) : null) || null, dropped: null, note: '' };
        let source = 'none';
        if (evidence.kept) source = 'run-kept';
        else if (dropped.has(record.uid)) { evidence.dropped = dropped.get(record.uid); source = 'run-dropped'; }
        else if (!core.getManualBearVerdictFromRecord(record)) {
            // Nothing in the run speaks for it: the calendar's own copy goes
            // through the bear check exactly as a scraped event would.
            const sourceConfig = findSourceConfigForEvent(core, event, parserConfigs);
            const parserConfig = sourceConfig
                ? { ...sourceConfig, ai: { ...(sourceConfig.ai || globalAi), cache: false } }
                : { name: 'saved-calendar-audit', ai: globalAi };
            if (options.ai === false) {
                const stored = core.findStoredBearVerdictMatch(event);
                evidence.note = 'not seen this run, AI off';
                if (stored && stored.entry) {
                    const verdict = stored.entry.verdict;
                    // Inside a bear run the run keeps the party unless the
                    // not-bear was given during it (SharedCore.getBearRunKeyForEvent).
                    const runKey = verdict === 'not_bear' ? core.getBearRunKeyForEvent(event) : '';
                    if (runKey && !core.findRunNightNotBearVerdict(event, runKey)) evidence.kept = { bearSource: `tagged (bear-run: ${runKey})` };
                    else if (verdict === 'not_bear') evidence.dropped = { reason: `manual store: not_bear (${stored.matchedBy})` };
                    else evidence.kept = { bearSource: verdict === 'tagged' ? 'manual-tagged (verdict store)' : 'manual-bear (verdict store)' };
                }
            } else {
                const drops = [];
                const keptNow = await core.filterBearEvents([{ ...event }], parserConfig, adapter, drops);
                asked += 1;
                if (keptNow.length > 0) evidence.kept = keptNow[0];
                else if (drops.length > 0) evidence.dropped = drops[0];
            }
            source = 'copy';
            evidence.sourceConfig = sourceConfig ? sourceConfig.name : '';
        }
        judged.push({ record, event, evidence: source, verdict: classifySavedRecord(core, record, evidence) });
    }
    return buildReport(core, judged, {
        runId: loaded.runId,
        generatedAt: new Date(now).toISOString(),
        cities: new Set(saved.map((record) => record.city)).size,
        askedFromCopy: asked
    });
}

function formatReport(report) {
    const lines = [];
    const table = (title, tallies) => {
        lines.push('', title);
        Object.keys(tallies).sort().forEach((key) => {
            lines.push(`  ${key.padEnd(52)} ${String(tallies[key].parties).padStart(4)} parties ${String(tallies[key].events).padStart(5)} events`);
        });
    };
    lines.push(`Saved-event audit — run ${report.runId}, ${report.cities} city calendars`);
    lines.push(`  singles: ${report.totals.singles.events} events in ${report.totals.singles.parties} parties · series: ${report.totals.series.events} in ${report.totals.series.parties} parties · judged from the calendar copy: ${report.askedFromCopy} · parties whose nights disagree: ${report.mixedParties}`);
    table('Singles', report.singles);
    table('Singles, by tier and evidence', report.singlesByTier);
    table('Series', report.series);
    return lines.join('\n');
}

async function main(argv) {
    const args = { ai: true };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--run') args.runId = argv[++index];
        else if (arg === '--city') args.city = argv[++index];
        else if (arg === '--out') args.out = argv[++index];
        else if (arg === '--no-ai') args.ai = false;
        else throw new Error(`unknown argument ${arg}`);
    }
    // The pipeline narrates every step; the audit prints one table.
    const channels = ['log', 'info', 'warn', 'debug'];
    const spoken = channels.map((channel) => console[channel]);
    channels.forEach((channel) => { console[channel] = () => {}; });
    let report;
    try {
        report = await runAudit(args);
    } finally {
        channels.forEach((channel, index) => { console[channel] = spoken[index]; });
    }
    if (args.out) fs.writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 1));
    console.log(formatReport(report));
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(`audit-saved-events: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    createAuditAdapter,
    readSavedInventory,
    savedRecordAsEvent,
    collectKeptEvidence,
    collectSeriesEvidence,
    matchDroppedToSaved,
    findSourceConfigForEvent,
    classifySavedRecord,
    buildReport,
    runAudit,
    formatReport
};

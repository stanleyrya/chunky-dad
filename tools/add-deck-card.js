#!/usr/bin/env node
// Add, list or drop a MANUAL card on the review deck (tools/review-queue.js
// manual cards): a one-off the assistant writes by hand for the owner to
// swipe. The card lands in <sharedRoot>/manual-cards.json (the iCloud data
// folder, CHUNKY_SHARED_STORAGE_DIR to override); the Mac is its only writer.
//
//   node tools/add-deck-card.js remove --city sydney --uid <uid> --why "…"
//   node tools/add-deck-card.js edit   --city sydney --uid <uid> --why "…" --set endDate=2026-10-16T22:00:00+11:00
//   node tools/add-deck-card.js choose --title "…" --why "…" --option "Keep A" --option "Keep B" [--city sf --uid <uid>]
//   node tools/add-deck-card.js list
//   node tools/add-deck-card.js drop --key "manual|…"
//
// With --city and --uid, the saved record is read from the published calendar
// (data/calendars/<city>.ics) so the card carries its title, night, bar and
// address, and an edit's "before" is the record's current value (--from
// overrides it). --title / --start / --end fill those by hand instead.
const fs = require('fs');
const path = require('path');
const reviewQueue = require('./review-queue');

function parseArgs(argv) {
    const out = { _: [], set: [], from: [], option: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) { out._.push(arg); continue; }
        const name = arg.slice(2);
        const value = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
        if (name === 'set' || name === 'from' || name === 'option') out[name].push(value);
        else out[name] = value;
    }
    return out;
}

function readSavedRecord(repoRoot, city, uid) {
    const { SharedCore } = require('../scripts/shared-core');
    const { EventSchema } = require('../scripts/event-schema');
    const file = path.join(repoRoot, 'data', 'calendars', `${city}.ics`);
    if (!fs.existsSync(file)) throw new Error(`no published calendar for "${city}" (${file})`);
    const core = new SharedCore({}, { eventSchema: EventSchema });
    const records = SharedCore.parsePublishedCalendarIcs(fs.readFileSync(file, 'utf8')) || [];
    const start = new Date(); start.setDate(start.getDate() - 30);
    const end = new Date(); end.setDate(end.getDate() + 400);
    const events = SharedCore.expandPublishedCalendarEventsInWindow(records, start, end).events;
    const hit = events.find((event) => SharedCore.savedEventUid(event.identifier) === uid || String(event.identifier || '') === uid);
    if (!hit) throw new Error(`no saved event with uid ${uid} in ${city}'s published calendar (last 30 days … next 400)`);
    const fields = core.parseNotesIntoFields(String(hit.notes || ''));
    return {
        identifier: String(hit.identifier || ''),
        uid: SharedCore.savedEventUid(hit.identifier),
        title: String(hit.title || ''),
        startDate: hit.startDate instanceof Date ? hit.startDate.toISOString() : null,
        endDate: hit.endDate instanceof Date ? hit.endDate.toISOString() : null,
        location: String(hit.location || ''),
        url: String(hit.url || ''),
        notes: String(hit.notes || ''),
        bar: String(fields.bar || ''),
        address: String(fields.address || ''),
        series: Boolean(hit.recurrence)
    };
}

function pairs(list) {
    const out = {};
    for (const item of list) {
        const eq = item.indexOf('=');
        if (eq <= 0) throw new Error(`expected field=value, got "${item}"`);
        out[item.slice(0, eq)] = item.slice(eq + 1);
    }
    return out;
}

function buildCard(args, options = {}) {
    const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
    const action = args._[0];
    const city = String(args.city || '').trim();
    const uid = String(args.uid || '').trim();
    const record = city && uid ? readSavedRecord(repoRoot, city, uid) : null;
    if (record && record.series) throw new Error('that saved event is a series — manual cards never touch a series');
    const cities = (() => { try { const sc = require('../scripts/scraper-cities'); return (sc && sc.cities) || sc || {}; } catch (_) { return {}; } })();
    const timezone = args.timezone || (cities[city] && cities[city].timezone) || null;
    const input = {
        action,
        title: args.title || (record && record.title) || '',
        why: args.why || '',
        city,
        uid: record ? record.uid : uid,
        identifier: record ? record.identifier : uid,
        startDate: args.start || (record && record.startDate) || null,
        endDate: args.end || (record && record.endDate) || null,
        timezone,
        bar: args.bar || (record && record.bar) || '',
        address: args.address || (record && record.address) || '',
        createdBy: args.by || 'claude',
        expiresAt: args.expires || null
    };
    if (action === 'edit') {
        const sets = pairs(args.set);
        const froms = pairs(args.from);
        input.changes = {};
        Object.keys(sets).forEach((field) => {
            const before = froms[field] !== undefined ? froms[field] : (record ? record[field] : '');
            input.changes[field] = { from: before === null ? '' : before, to: sets[field] };
        });
    }
    if (action === 'choose') input.options = args.option;
    return reviewQueue.normalizeManualCard(input);
}

function main(argv, options = {}) {
    const args = parseArgs(argv);
    const sharedRoot = options.sharedRoot || reviewQueue.resolveSharedRoot();
    const cardsPath = reviewQueue.getManualCardsPath(sharedRoot);
    const store = reviewQueue.loadManualCards(cardsPath);
    const command = args._[0];
    const log = options.log || console.log;
    if (command === 'list') {
        if (store.cards.length === 0) { log(`no manual cards (${cardsPath})`); return { cards: [] }; }
        store.cards.forEach((card) => log(`${card.key}  ${card.action.toUpperCase()}  ${card.title}  ${card.city || ''} ${String(card.startDate || '').slice(0, 10)}  — ${card.why}`));
        return { cards: store.cards };
    }
    if (command === 'drop') {
        const key = String(args.key || '').trim();
        if (!key) throw new Error('drop needs --key');
        const dropped = reviewQueue.dropManualCard(store, key);
        reviewQueue.saveManualCards(cardsPath, dropped.store);
        log(dropped.removed ? `dropped ${key}` : `${key} was not on the deck`);
        return { removed: dropped.removed };
    }
    if (!reviewQueue.MANUAL_ACTIONS.includes(command)) {
        throw new Error(`usage: add-deck-card.js <remove|edit|choose|list|drop> … (see the header of tools/add-deck-card.js)`);
    }
    const card = buildCard(args, options);
    reviewQueue.saveManualCards(cardsPath, reviewQueue.upsertManualCard(store, card));
    log(`✍️ ${card.action.toUpperCase()} card on the deck: ${card.key}\n   ${card.title}${card.startDate ? ` — ${String(card.startDate).slice(0, 16)}` : ''}${card.bar ? ` @ ${card.bar}` : ''}\n   ${card.why}${card.changes ? `\n   ${Object.keys(card.changes).map((f) => `${f}: ${card.changes[f].from || '∅'} → ${card.changes[f].to || '∅'}`).join('; ')}` : ''}${card.options ? `\n   → ${card.options[0]} · ← ${card.options[1]}` : ''}\n   (${cardsPath})`);
    return { card };
}

module.exports = { parseArgs, readSavedRecord, buildCard, main };

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(`add-deck-card: ${error.message}`);
        process.exit(1);
    }
}

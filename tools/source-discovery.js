#!/usr/bin/env node
// ============================================================================
// SOURCE DISCOVERY — the websites we SHOULD be reading and are not
// ============================================================================
// The project already knows more first-party sites than it reads. Every
// aggregator row (The Bear Calendar, Thotyssey, Gathr, whereto.party, Bear
// World Magazine) points at the event's own page; every published calendar
// event carries a `website:` line; every curated bar and promoter record
// names a site. None of that is a configured parser until someone notices.
// This tool is the noticing, done by machine, from data that is already on
// disk — it fetches nothing (the one-request-per-site door classification
// is a separate, slower, polite step a person runs on the top of this list).
//
// What it does, in order:
//   1. Collects every outbound link (url / website / ticketUrl, the same
//      lines inside `notes`) from the last finished run — parser results
//      and the bear-check drops — plus the 71 published city calendars
//      (data/calendars/*.ics), data/bars/*.json, data/promoters.json and
//      data/festivals.json.
//   2. Reduces each link to the SITE it names: the registrable domain
//      (SharedCore.getRegistrableDomainFromUrl — one implementation, the
//      scraper's own) or, on a ticketing/listing platform, the ORGANIZER
//      PAGE on that platform (eventbrite.com/o/<id>, dice.fm/partner/<slug>,
//      ra.co/promoters/<id> …) — a platform is never a source by itself, an
//      organizer page on it is a door the scraper already knows how to read.
//      Social networks and link hubs are never candidates (policy: no
//      Instagram/Facebook reading, ever); instagram handles that appear
//      WITHOUT any web door are kept aside so the owner knows they exist.
//   3. Drops what the scraper already reads: the registrable domain of every
//      configured parser URL, every aggregatorHost, and — for platform doors
//      — the exact organizer page.
//   4. Scores what is left by how much of our own data points at it:
//      distinct events, distinct cities, events kept as bear, which
//      aggregators named it, whether a promoter/bar/festival record already
//      knows it, and how recent the latest event is.
//
// Also reports SOURCE COVERAGE BY CITY: for every city calendar, which
// configured first-party parsers produced events there this run (aggregator
// rows do not count — they are discovery only), so the calendars with 0–1
// sources are visible beside the candidates that would fill them.
//
// Usage:
//   node tools/source-discovery.js [--run <run.json>] [--json <out.json>]
//                                  [--min-events N] [--city <key>] [--limit N]
//                                  [--coverage]
// Defaults: the newest runs/*.json under the shared storage root
// (CHUNKY_SHARED_STORAGE_DIR or the iCloud chunky-dad-data folder); repo
// data from this checkout. Exit code is always 0 — this is a report.
// ============================================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Platform knowledge — data only, mirrors the scraper's own lists.
// ---------------------------------------------------------------------------

// Hosts that are a PERSON's presence on a network, never a readable source.
// Policy (owner, 2026-10-11): nothing in the pipeline fetches Instagram or
// Facebook. Handles are evidence that a promoter exists, nothing more.
const SOCIAL_HOSTS = [
    'instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'twitter.com', 'x.com',
    'tiktok.com', 'threads.net', 'bsky.app', 'youtube.com', 'youtu.be',
    'snapchat.com', 'mastodon.social', 'tumblr.com', 'pinterest.com',
    'whatsapp.com', 'telegram.org', 't.me', 'discord.gg', 'discord.com'
];

// Link hubs: one page of outbound links, no events of its own. Cubhouse is
// configured on one (the crawl follows its links), but a hub seen in the
// data tells us only that a promoter exists — the hub's targets are what
// we want, and those arrive as their own links.
const LINK_HUB_HOSTS = [
    'linktr.ee', 'linktree.com', 'beacons.ai', 'lnk.bio', 'bio.site', 'carrd.co',
    'allmylinks.com', 'solo.to', 'campsite.bio', 'tap.bio', 'hoo.be', 'linkin.bio'
];

// Utilities that appear as links on event pages and are never event sources.
const NOT_A_SOURCE_HOSTS = [
    'google.com', 'goo.gl', 'maps.app.goo.gl', 'apple.com', 'bit.ly', 'tinyurl.com',
    'spotify.com', 'soundcloud.com', 'paypal.com', 'paypal.me', 'venmo.com', 'cash.app',
    'gofundme.com', 'wikipedia.org', 'imgur.com', 'squarespace-cdn.com', 'wixstatic.com',
    'imgix.net', 'cloudfront.net', 'googleusercontent.com', 'gstatic.com', 'amazonaws.com',
    'mailchi.mp', 'list-manage.com', 'gaycities.com', 'chunky.dad',
    // Forms and store builders: an RSVP form or a merch page, never a listing
    // (the-bear-shop.fourthwall.com is BEEFMINCE's merch, probed 2026-10-17).
    'forms.gle', 'tally.so', 'fillout.com', 'typeform.com', 'jotform.com', 'square.site', 'squareup.com', 'fourthwall.com'
];

// Path nouns that an organizer regex can catch instead of a name
// (dice.fm/partner/tickets/event/…, events.ticketleap.com/tickets/<org>/…).
const ORGANIZER_STOP_TOKENS = new Set(['tickets', 'ticket', 'event', 'events', 'e', 'o', 'www', 'host', 'organizer', 'organiser']);

// Ticketing / listing platforms and the URL shape of an ORGANIZER page on
// each — the unit the scraper configures (Megawoof America, Bearracuda,
// Xposure Events, Bearhood Berlin, Bears of London are all eventbrite /o/
// pages). The regex captures the organizer key; a platform URL that does
// not match (an event page, a search page) still counts for the platform
// but with no organizer — those rows are "organizer unknown: one fetch of
// the event page would name it".
const PLATFORM_DOORS = [
    { host: 'eventbrite', match: /^eventbrite\.[a-z.]+$/, organizer: /\/o\/([^/?#]+)/i, door: 'Eventbrite organizer page' },
    { host: 'dice.fm', organizer: /\/(?:partner|venue)\/([^/?#]+)/i, door: 'DICE partner/venue page' },
    { host: 'ra.co', organizer: /\/(?:promoters|clubs)\/(\d+)/i, door: 'Resident Advisor promoter/club page' },
    { host: 'residentadvisor.net', organizer: /\/(?:promoters|clubs)\/(\d+)/i, door: 'Resident Advisor promoter/club page' },
    { host: 'tickettailor.com', organizer: /^https?:\/\/(?:www\.)?tickettailor\.com\/events\/([^/?#]+)/i, door: 'Ticket Tailor box office' },
    // events.humanitix.com/<slug> is an EVENT; the organizer lives at /host/<slug>.
    { host: 'humanitix.com', organizer: /humanitix\.com\/host\/([^/?#]+)/i, door: 'Humanitix host page' },
    // events.ticketleap.com/tickets/<org>/<event> or <org>.ticketleap.com.
    { host: 'ticketleap.com', organizer: [/ticketleap\.com\/tickets\/([^/?#]+)/i, /^https?:\/\/(?!events\.|www\.)([^.]+)\.ticketleap\.com/i], door: 'TicketLeap organizer page' },
    { host: 'ticketleap.events', organizer: /^https?:\/\/([^.]+)\.ticketleap\.events/i, door: 'TicketLeap organizer page' },
    { host: 'tockify.com', organizer: /tockify\.com\/([^/?#]+)/i, door: 'Tockify calendar (JSON feed)' },
    { host: 'universe.com', organizer: /universe\.com\/(?:users\/)?([^/?#]+)/i, door: 'Universe organizer page' },
    { host: 'withfriends.co', organizer: /withfriends\.co\/([^/?#]+)/i, door: 'Withfriends organizer page' },
    { host: 'posh.vip', organizer: /posh\.vip\/(?:g|o)\/([^/?#]+)/i, door: 'Posh group page' },
    { host: 'shotgun.live', organizer: /shotgun\.live\/(?:[a-z]{2}\/)?(?:organizers|venues)\/([^/?#]+)/i, door: 'Shotgun organizer page' },
    { host: 'fatsoma.com', organizer: /fatsoma\.com\/p\/([^/?#]+)/i, door: 'Fatsoma promoter page' },
    { host: 'meetup.com', organizer: /meetup\.com\/([^/?#]+)/i, door: 'Meetup group page' },
    { host: 'partiful.com', organizer: null, door: 'Partiful event page (no organizer listing)' },
    { host: 'lu.ma', organizer: /lu\.ma\/([^/?#]+)/i, door: 'Luma calendar' },
    { host: 'luma.com', organizer: /luma\.com\/([^/?#]+)/i, door: 'Luma calendar' },
    { host: 'sickening.events', organizer: null, door: 'Sickening server-side search (?q=)' },
    { host: 'redeyetickets.com', organizer: null, door: 'RedEye JSON API search' },
    { host: 'ticketsauce.com', organizer: /^https?:\/\/([^.]+)\.ticketsauce\.com/i, door: 'TicketSauce organizer subdomain' },
    { host: 'tixr.com', organizer: /tixr\.com\/groups\/([^/?#]+)/i, door: 'Tixr group page' },
    { host: 'eventeny.com', organizer: /eventeny\.com\/(?:company|profile)\/([^/?#]+)/i, door: 'Eventeny organizer page' },
    { host: 'showclix.com', organizer: null, door: 'ShowClix event page' },
    { host: 'etix.com', organizer: null, door: 'Etix event page' },
    { host: 'eventim.us', organizer: null, door: 'Eventim event page' },
    { host: 'seetickets.com', organizer: null, door: 'See Tickets event page' },
    { host: 'seetickets.us', organizer: null, door: 'See Tickets event page' },
    { host: 'ticketweb.com', organizer: null, door: 'TicketWeb event page' },
    { host: 'ticketmaster.com', organizer: null, door: 'Ticketmaster event page' },
    { host: 'camplife.com', organizer: null, door: 'CampLife booking page' },
    { host: 'eventcreate.com', organizer: null, door: 'EventCreate event page' },
    { host: 'ticketspice.com', organizer: /^https?:\/\/([^.]+)\.ticketspice\.com/i, door: 'TicketSpice organizer subdomain' },
    { host: 'simpletix.com', organizer: null, door: 'SimpleTix event page' },
    { host: 'brownpapertickets.com', organizer: null, door: 'Brown Paper Tickets event page' },
    { host: 'hopin.com', organizer: null, door: 'Hopin event page' },
    { host: 'ticketspace.com', organizer: null, door: 'ticket page' },
    { host: 'fixr.co', organizer: /fixr\.co\/organiser\/([^/?#]+)/i, door: 'FIXR organiser page' },
    { host: 'skiddle.com', organizer: /skiddle\.com\/(?:whats-on\/[^/]+\/)?([^/?#]+)/i, door: 'Skiddle listing' },
    { host: 'outsavvy.com', organizer: /outsavvy\.com\/organiser\/([^/?#]+)/i, door: 'OutSavvy organiser page' },
    { host: 'eventix.io', organizer: null, door: 'Eventix shop' },
    { host: 'billetweb.fr', organizer: null, door: 'Billetweb event page' },
    { host: 'weezevent.com', organizer: null, door: 'Weezevent event page' },
    { host: 'boletia.com', organizer: null, door: 'Boletia event page' },
    { host: 'passline.com', organizer: null, door: 'Passline event page' },
    { host: 'moshtix.com.au', organizer: null, door: 'Moshtix event page' },
    { host: 'oztix.com.au', organizer: null, door: 'Oztix event page' },
    { host: 'megatix.com.au', organizer: null, door: 'Megatix event page' },
    { host: 'ticketek.com.au', organizer: null, door: 'Ticketek event page' },
    { host: 'quicket.co.za', organizer: null, door: 'Quicket event page' },
    { host: 'eventpop.me', organizer: null, door: 'Event Pop event page' },
    { host: 'peatix.com', organizer: null, door: 'Peatix event page' },
    { host: 'zaiko.io', organizer: null, door: 'ZAIKO event page' },
    { host: 'livepocket.jp', organizer: null, door: 'LivePocket event page' },
    { host: 'ticketplus.com.tw', organizer: null, door: 'ticket page' },
    { host: 'kktix.cc', organizer: null, door: 'KKTIX event page' },
    { host: 'ticketbud.com', organizer: null, door: 'Ticketbud event page' },
    { host: 'goout.net', organizer: null, door: 'GoOut event page' },
    { host: 'wegow.com', organizer: null, door: 'Wegow event page' },
    { host: 'entradium.com', organizer: null, door: 'Entradium event page' },
    { host: 'fourvenues.com', organizer: null, door: 'Fourvenues event page' },
    { host: 'xceed.me', organizer: null, door: 'Xceed event page' },
    { host: 'ticketswap.com', organizer: null, door: 'resale — not a source' },
    { host: 'stubhub.com', organizer: null, door: 'resale — not a source' }
];

const LINK_FIELDS = ['url', 'website', 'ticketUrl'];
// The same three names as lines inside `notes` (the calendar carries event
// fields that way; `url:` in a note is an alias of `website:`).
const NOTE_LINK_LINE = /^(?:url|website|ticketUrl|ticketurl)\s*:\s*(https?:\/\/\S+)/i;

function hostMatches(host, list) {
    const normalized = String(host || '').toLowerCase();
    if (!normalized) return false;
    return list.some(entry => normalized === entry || normalized.endsWith(`.${entry}`));
}

// Load the scraper's own domain reducer rather than re-implementing the
// compound-suffix rule (co.uk, com.au …) a second time.
function loadSharedCore() {
    const { SharedCore } = require(path.join(repoRoot, 'scripts', 'shared-core'));
    const { EventSchema } = require(path.join(repoRoot, 'scripts', 'event-schema'));
    let cities = {};
    try { cities = require(path.join(repoRoot, 'scripts', 'scraper-cities')); } catch (_) { /* optional */ }
    const core = new SharedCore(cities && typeof cities === 'object' ? cities : {}, { eventSchema: EventSchema });
    return { core, SharedCore };
}

function defaultSharedRoot(home = os.homedir(), fsLike = fs) {
    const env = String(process.env.CHUNKY_SHARED_STORAGE_DIR || '').trim();
    if (env) return path.resolve(env);
    const moved = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'chunky-dad-data');
    try { if (fsLike.statSync(path.join(moved, 'runs')).isDirectory()) return moved; } catch (_) { /* fall through */ }
    return path.join(home, 'Library', 'Mobile Documents', 'iCloud~dk~simonbs~Scriptable', 'Documents', 'chunky-dad-scraper');
}

function newestRunFile(runsDir) {
    let names = [];
    try { names = fs.readdirSync(runsDir); } catch (_) { return null; }
    const runs = names.filter(name => /^\d{8}-\d{6}\.json$/.test(name)).sort();
    return runs.length ? path.join(runsDir, runs[runs.length - 1]) : null;
}

// ---------------------------------------------------------------------------
// Link → site key
// ---------------------------------------------------------------------------

// Reduce one URL to the thing we could configure. Returns null for links
// that can never be a source (social, hubs, utilities, unparseable), else
// { key, domain, kind: 'site' | 'platform', platform?, organizer?, door?, url }.
//   site:      key = registrable domain            (eaglela.com)
//   platform:  key = platform + organizer page     (eventbrite.com/o/megawoof-america-18118978189)
//              or   platform + '(organizer unknown)' when the URL is an event page.
function classifyLink(url, core) {
    const raw = String(url || '').trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    const domain = core.getRegistrableDomainFromUrl(raw);
    if (!domain || !domain.includes('.')) return null;
    if (hostMatches(domain, SOCIAL_HOSTS)) return { kind: 'social', domain, url: raw };
    if (hostMatches(domain, LINK_HUB_HOSTS)) return { kind: 'hub', domain, url: raw };
    if (hostMatches(domain, NOT_A_SOURCE_HOSTS)) return null;
    const platform = PLATFORM_DOORS.find(entry => entry.match ? entry.match.test(domain) : hostMatches(domain, [entry.host]));
    if (!platform) return { kind: 'site', key: domain, domain, url: raw };
    if (/not a source/.test(platform.door)) return null;
    let organizer = '';
    const patterns = Array.isArray(platform.organizer) ? platform.organizer : (platform.organizer ? [platform.organizer] : []);
    for (const pattern of patterns) {
        const found = raw.match(pattern);
        const token = found && found[1] ? decodeURIComponent(found[1]).toLowerCase() : '';
        if (token && !ORGANIZER_STOP_TOKENS.has(token)) { organizer = token; break; }
    }
    // eventbrite.de / .co.uk / .com all serve the same organizer page — one
    // key per organizer, whichever country door the link used.
    const platformName = platform.match ? 'eventbrite.com' : platform.host;
    const key = organizer
        ? `${platformName}/${platform.host === 'eventbrite' ? 'o/' : ''}${organizer}`
        : `${platformName} (organizer unknown)`;
    return { kind: 'platform', key, domain, platform: platformName, organizer, door: platform.door, url: raw };
}

// Every outbound link an event record carries, as [field, url].
function eventLinks(event) {
    const links = [];
    if (!event || typeof event !== 'object') return links;
    for (const field of LINK_FIELDS) {
        const value = event[field];
        if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) links.push([field, value.trim()]);
    }
    const notes = typeof event.notes === 'string' ? event.notes : '';
    for (const line of notes.split(/\r?\n/)) {
        const match = line.trim().match(NOTE_LINK_LINE);
        if (match) links.push(['notes', match[1]]);
    }
    return links;
}

function instagramHandle(url) {
    const match = String(url || '').match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    const handle = match ? match[1].toLowerCase() : '';
    return handle && !['p', 'reel', 'explore', 'stories', 'accounts'].includes(handle) ? handle : '';
}

// ---------------------------------------------------------------------------
// Configured coverage — what the scraper already reads
// ---------------------------------------------------------------------------

// What the scraper already reads, as site keys, each remembering the
// parser that owns it (so a calendar event's link can be traced back to the
// source that wrote it). Three ways a site counts as configured:
//   - a parser URL is on it (registrable domain, or the organizer page on a
//     platform — a platform search/API door such as Goldiloxx's covers only
//     that promoter, never the host);
//   - a VENUE parser's metadata.website names it (Dallas Eagle once read
//     an eventbrite page while its own site was the identity);
//   - a promoter record whose name IS a parser's name (or whose urlPatterns
//     include a configured organizer page) names it as website — Lodge NY is
//     read through its public Google Calendar feed, and lodgeny.com is known
//     only from data/promoters.json. Without this join the tool's #1 finding
//     is a site the scraper has read for months.
function buildConfiguredIndex(parsers, core, promoters) {
    const index = { domains: new Map(), keys: new Map(), hubPages: new Map(), aggregatorHosts: new Set(), parsers: [] };
    const own = (map, key, name) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(name); };
    for (const parser of Array.isArray(parsers) ? parsers : []) {
        if (!parser || parser.template) continue;
        const name = String(parser.name || '');
        const urls = Array.isArray(parser.urls) ? parser.urls : [];
        const classified = urls.map(url => classifyLink(url, core)).filter(Boolean);
        for (const link of classified) {
            if (link.kind === 'site') own(index.domains, link.domain, name);
            // A hub covers its own handle's page only (linktr.ee/cubhouse),
            // never the hub host — the scope buildFirstPartySiteCoverage gives it.
            if (link.kind === 'hub') own(index.hubPages, urlPageKey(link.url), name);
            if (link.kind === 'platform' && link.organizer) own(index.keys, link.key, name);
        }
        for (const host of Array.isArray(parser.aggregatorHosts) ? parser.aggregatorHosts : []) {
            const domain = core.getRegistrableDomainFromHost(host);
            if (domain) index.aggregatorHosts.add(domain);
        }
        const metaSite = parser.metadata && parser.metadata.website && parser.metadata.website.value;
        if (typeof metaSite === 'string') {
            const link = classifyLink(metaSite, core);
            if (link && link.kind === 'site') own(index.domains, link.domain, name);
        }
        index.parsers.push({ name, siteRole: String(parser.siteRole || ''), domains: classified.filter(link => link.kind === 'site').map(link => link.domain) });
    }
    const parserNames = new Map(index.parsers.map(parser => [parser.name.toLowerCase(), parser.name]));
    for (const promoter of Array.isArray(promoters) ? promoters : []) {
        if (!promoter) continue;
        const names = [promoter.name].concat(Array.isArray(promoter.aliases) ? promoter.aliases : []).map(value => String(value || '').toLowerCase());
        const patternLinks = (Array.isArray(promoter.urlPatterns) ? promoter.urlPatterns : [])
            .map(pattern => classifyLink(`https://${String(pattern).replace(/^https?:\/\//, '')}`, core)).filter(Boolean);
        let owner = names.map(value => parserNames.get(value)).find(Boolean) || '';
        if (!owner) {
            const viaPattern = patternLinks.find(link => (link.kind === 'platform' && index.keys.has(link.key)) || (link.kind === 'site' && index.domains.has(link.domain)));
            if (viaPattern) owner = Array.from(viaPattern.kind === 'platform' ? index.keys.get(viaPattern.key) : index.domains.get(viaPattern.domain))[0];
        }
        if (!owner) continue;
        const siteLinks = [typeof promoter.website === 'string' ? classifyLink(promoter.website, core) : null].concat(patternLinks).filter(Boolean);
        for (const link of siteLinks) {
            if (link.kind === 'site') own(index.domains, link.domain, owner);
            if (link.kind === 'hub') own(index.hubPages, urlPageKey(link.url), owner);
            if (link.kind === 'platform' && link.organizer) own(index.keys, link.key, owner);
        }
    }
    return index;
}

// Which configured parser(s) a link belongs to ('' when none).
function configuredOwners(link, configured) {
    if (!link) return [];
    if (link.kind === 'site') return Array.from(configured.domains.get(link.domain) || []);
    if (link.kind === 'hub') return Array.from(configured.hubPages.get(urlPageKey(link.url)) || []);
    if (link.kind === 'platform' && link.organizer) return Array.from(configured.keys.get(link.key) || []);
    return [];
}

function isConfigured(link, configured) {
    if (!link) return true;
    if (link.kind === 'site') return configured.domains.has(link.domain) || configured.aggregatorHosts.has(link.domain);
    if (link.kind === 'platform') return Boolean(link.organizer) && configured.keys.has(link.key);
    if (link.kind === 'hub') return configured.hubPages.has(urlPageKey(link.url));
    return true;
}

// Exact-page identity for the "already carried" check: host + path, no
// query (utm_ tails differ between an aggregator's copy and the original).
function urlPageKey(url) {
    const match = String(url || '').trim().match(/^https?:\/\/([^/?#]+)([^?#]*)/i);
    if (!match) return '';
    return `${match[1].toLowerCase().replace(/^www\./, '')}${match[2].replace(/\/+$/, '').toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function eventIdentity(event, fallbackPrefix) {
    if (event && typeof event.key === 'string' && event.key) return event.key;
    const title = String((event && event.title) || '').toLowerCase().trim();
    const day = String((event && event.startDate) || '').slice(0, 10);
    return `${fallbackPrefix}|${title}|${day}`;
}

function readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

// Published calendar events: the ICS files are the calendar as the site
// shows it — everything in them was kept as bear, with its city in the
// file name.
function collectCalendarEvents(calendarsDir, SharedCore) {
    const out = [];
    let names = [];
    try { names = fs.readdirSync(calendarsDir); } catch (_) { return out; }
    for (const name of names) {
        if (!name.endsWith('.ics') || name === 'festivals.ics') continue;
        const city = name.replace(/\.ics$/, '');
        const text = fs.readFileSync(path.join(calendarsDir, name), 'utf8');
        const records = SharedCore.parsePublishedCalendarIcs(text) || [];
        for (const record of records) {
            const notes = record.description || '';
            const startDate = record.start && record.start.date instanceof Date && !Number.isNaN(record.start.date.getTime())
                ? record.start.date.toISOString()
                : (record.start && record.start.iso) || '';
            out.push({
                title: record.summary, startDate, city, notes, url: record.url || '',
                isBearEvent: true, key: `ics:${record.uid}`
            });
        }
    }
    return out;
}

// One observation = one event record pointing at one site key.
function makeCandidate(link) {
    return {
        key: link.key, kind: link.kind, domain: link.domain,
        platform: link.platform || '', organizer: link.organizer || '', door: link.door || '',
        events: new Set(), bearEvents: new Set(), cities: new Set(),
        namedBy: new Set(), aggregators: new Set(), fields: new Set(),
        knownAs: new Set(), latest: '', sampleUrls: new Set(), titles: new Set(), labels: new Map()
    };
}

function noteObservation(candidates, link, context) {
    let candidate = candidates.get(link.key);
    if (!candidate) { candidate = makeCandidate(link); candidates.set(link.key, candidate); }
    if (context.eventId) {
        candidate.events.add(context.eventId);
        if (context.isBear) candidate.bearEvents.add(context.eventId);
    }
    if (context.city && context.city !== 'unknown') candidate.cities.add(context.city);
    if (context.namedBy) candidate.namedBy.add(context.namedBy);
    if (context.aggregator) candidate.aggregators.add(context.aggregator);
    if (context.field) candidate.fields.add(context.field);
    if (context.knownAs) candidate.knownAs.add(context.knownAs);
    if (context.startDate && context.startDate > candidate.latest) candidate.latest = context.startDate;
    if (candidate.sampleUrls.size < 3) candidate.sampleUrls.add(link.url);
    if (context.title && candidate.titles.size < 12) candidate.titles.add(context.title);
    // Who the event belongs to, for platform rows whose URL names no
    // organizer: the promoter brand the run stamped, else the venue.
    if (context.label) candidate.labels.set(context.label, (candidate.labels.get(context.label) || 0) + 1);
}

function eventLabel(event) {
    if (!event || typeof event !== 'object') return '';
    if (event._promoter && typeof event._promoter.name === 'string') return event._promoter.name;
    if (typeof event.shortName === 'string' && event.shortName) return event.shortName.replace(/\u00ad/g, '');
    if (typeof event.bar === 'string' && event.bar) return event.bar;
    return '';
}

// Score: what our own data says about the site's weight. Deliberately
// plain so a reader can redo it by hand from the row:
//   events + 2×bear events + 3×cities, +2 if an aggregator named it (the
//   aggregator's editors already judged it an event source), +1 if a
//   promoter/bar/festival record knows it, +2 if its latest event is still
//   ahead of today (a live site, not an archive).
function scoreCandidate(candidate, todayIso) {
    let score = candidate.events.size + 2 * candidate.bearEvents.size + 3 * candidate.cities.size;
    if (candidate.aggregators.size) score += 2;
    if (candidate.knownAs.size) score += 1;
    if (candidate.latest && candidate.latest.slice(0, 10) >= todayIso) score += 2;
    return score;
}

function discoverSources(input) {
    const { core, SharedCore } = input.shared || loadSharedCore();
    const today = input.today || new Date().toISOString().slice(0, 10);
    const parsers = input.parsers || [];
    const configured = buildConfiguredIndex(parsers, core, input.promoters || []);
    const aggregatorNames = new Set(configured.parsers.filter(p => p.siteRole === 'aggregator').map(p => p.name));
    const candidates = new Map();
    const socialOnly = new Map();   // instagram handle → { events, cities, titles }
    const hubsSeen = new Map();     // link hub URL → count
    const coverage = new Map();     // city → { parsers: Set, events, bear, calendarEvents }

    const touchCity = (city) => {
        if (!city || city === 'unknown') return null;
        if (!coverage.has(city)) coverage.set(city, { parsers: new Set(), calendarSources: new Set(), aggregatorEvents: 0, events: 0, bear: 0, calendarEvents: 0 });
        return coverage.get(city);
    };

    // Pages a FIRST-PARTY parser already carries this run (its own events'
    // url/website/ticketUrl). An aggregator copy or a calendar line pointing
    // at the same page is not a discovery — the source is read.
    const coveredPages = new Set();
    const observeEvent = (event, source) => {
        const eventId = eventIdentity(event, source.namedBy);
        const links = eventLinks(event);
        const classified = links.map(([field, url]) => [field, classifyLink(url, core)]).filter(([, link]) => link);
        const webDoor = classified.some(([, link]) => link.kind === 'site' || link.kind === 'platform');
        const label = eventLabel(event);
        // An aggregator copy that ALSO links a configured source (website
        // linktr.ee/megawoof_america beside an eventbrite /e/ ticket page)
        // is that source's event: the anonymous ticket page is already
        // reached through the organizer page we read.
        const ownedByConfigured = classified.some(([, link]) => configuredOwners(link, configured).length > 0);
        for (const [field, link] of classified) {
            if (source.firstParty && (link.kind === 'site' || link.kind === 'platform')) coveredPages.add(urlPageKey(link.url));
            if (link.kind === 'social') {
                const handle = instagramHandle(link.url);
                if (handle && !webDoor) {
                    const entry = socialOnly.get(handle) || { handle, events: new Set(), cities: new Set(), titles: new Set(), namedBy: new Set() };
                    entry.events.add(eventId);
                    if (event.city && event.city !== 'unknown') entry.cities.add(event.city);
                    if (entry.titles.size < 3) entry.titles.add(String(event.title || ''));
                    entry.namedBy.add(source.namedBy);
                    socialOnly.set(handle, entry);
                }
                continue;
            }
            if (link.kind === 'hub') { hubsSeen.set(link.url, (hubsSeen.get(link.url) || 0) + 1); continue; }
            if (isConfigured(link, configured)) continue;
            // A ticket page with no organizer in its URL, hanging off an event
            // a first-party parser already produced: that event is captured;
            // the page tells us nothing we could configure. Only an aggregator
            // or the calendar pointing at such a page is a lead (the organizer
            // behind it may deserve a door of its own).
            if ((source.firstParty || ownedByConfigured) && link.kind === 'platform' && !link.organizer) continue;
            if (!source.firstParty && coveredPages.has(urlPageKey(link.url))) continue;
            noteObservation(candidates, link, {
                eventId, isBear: event.isBearEvent !== false, city: event.city, field, label,
                namedBy: source.namedBy, aggregator: source.aggregator, startDate: String(event.startDate || ''),
                title: String(event.title || '')
            });
        }
    };

    // 1. The run: parser results (what each source produced) and the bear
    //    drops (records that pointed somewhere even though they were not
    //    kept — a venue that hosts one bear night among many still counts).
    const run = input.run || {};
    const parserByDomain = new Map();
    const results = (Array.isArray(run.parserResults) ? run.parserResults : []).map(result => {
        const name = String(result.name || '');
        const isAggregator = aggregatorNames.has(name) || Boolean(result.config && result.config.siteRole === 'aggregator');
        return { result, name, isAggregator };
    });
    // First-party results first: their pages must be known before an
    // aggregator's copies are judged against them.
    results.sort((a, b) => Number(a.isAggregator) - Number(b.isAggregator));
    for (const { result, name, isAggregator } of results) {
        for (const url of Array.isArray(result.config && result.config.urls) ? result.config.urls : []) {
            const domain = core.getRegistrableDomainFromUrl(url);
            if (domain) parserByDomain.set(domain, { name, isAggregator });
        }
        for (const event of Array.isArray(result.events) ? result.events : []) {
            observeEvent(event, { namedBy: name, aggregator: isAggregator ? name : '', firstParty: !isAggregator });
            const cityEntry = touchCity(event.city);
            if (cityEntry) {
                if (isAggregator) cityEntry.aggregatorEvents += 1;
                else { cityEntry.parsers.add(name); cityEntry.events += 1; if (event.isBearEvent !== false) cityEntry.bear += 1; }
            }
        }
    }
    for (const drop of Array.isArray(run.bearDroppedEvents) ? run.bearDroppedEvents : []) {
        const event = drop && drop.event;
        if (!event) continue;
        const hostDomain = core.getRegistrableDomainFromHost(drop.host || '');
        const owner = parserByDomain.get(hostDomain) || { name: `host:${hostDomain}`, isAggregator: false };
        observeEvent(Object.assign({}, event, { isBearEvent: false }), { namedBy: owner.name, aggregator: owner.isAggregator ? owner.name : '', firstParty: !owner.isAggregator });
    }

    // 2. Published calendars.
    const calendarEvents = input.calendarEvents || (input.calendarsDir ? collectCalendarEvents(input.calendarsDir, SharedCore) : []);
    for (const event of calendarEvents) {
        observeEvent(event, { namedBy: `calendar:${event.city}`, aggregator: '' });
        const cityEntry = touchCity(event.city);
        if (!cityEntry) continue;
        cityEntry.calendarEvents += 1;
        // The calendar's own links name the configured source that wrote
        // each event — coverage that holds even on a run where that parser
        // produced nothing (Dallas Eagle at 0 events still feeds Dallas).
        for (const [, url] of eventLinks(event)) {
            for (const owner of configuredOwners(classifyLink(url, core), configured)) cityEntry.calendarSources.add(owner);
        }
    }

    // 3. Curated records — a bar/promoter/festival that names a website is
    //    a site we already vouch for; it just is not read yet.
    const curated = [];
    for (const bar of input.bars || []) {
        if (bar && typeof bar.website === 'string') curated.push({ url: bar.website, city: bar.city, knownAs: `bar: ${bar.name}`, namedBy: `bars:${bar.city || ''}` });
    }
    for (const promoter of input.promoters || []) {
        if (!promoter) continue;
        if (typeof promoter.website === 'string') curated.push({ url: promoter.website, knownAs: `promoter: ${promoter.name}`, namedBy: 'promoters' });
        for (const pattern of Array.isArray(promoter.urlPatterns) ? promoter.urlPatterns : []) {
            curated.push({ url: `https://${String(pattern).replace(/^https?:\/\//, '')}`, knownAs: `promoter: ${promoter.name}`, namedBy: 'promoters' });
        }
    }
    for (const festival of input.festivals || []) {
        if (festival && typeof festival.website === 'string') curated.push({ url: festival.website, knownAs: `festival: ${festival.name}`, namedBy: 'festivals' });
    }
    for (const record of curated) {
        const link = classifyLink(record.url, core);
        if (!link || link.kind === 'social' || link.kind === 'hub' || isConfigured(link, configured)) continue;
        noteObservation(candidates, link, { city: record.city, knownAs: record.knownAs, namedBy: record.namedBy, field: 'curated' });
    }

    // Rank.
    let rows = Array.from(candidates.values()).map(candidate => ({
        key: candidate.key, kind: candidate.kind, domain: candidate.domain, platform: candidate.platform,
        organizer: candidate.organizer, door: candidate.door,
        score: scoreCandidate(candidate, today),
        events: candidate.events.size, bearEvents: candidate.bearEvents.size,
        cities: Array.from(candidate.cities).sort(),
        namedBy: Array.from(candidate.namedBy).sort(), aggregators: Array.from(candidate.aggregators).sort(),
        fields: Array.from(candidate.fields).sort(), knownAs: Array.from(candidate.knownAs).sort(),
        latest: candidate.latest ? candidate.latest.slice(0, 10) : '',
        sampleUrls: Array.from(candidate.sampleUrls), titles: Array.from(candidate.titles),
        labels: Array.from(candidate.labels.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count }))
    }));
    const minEvents = Number(input.minEvents) || 0;
    if (minEvents > 0) rows = rows.filter(row => row.events >= minEvents);
    if (input.city) rows = rows.filter(row => row.cities.includes(input.city));
    rows.sort((a, b) => b.score - a.score || b.events - a.events || a.key.localeCompare(b.key));

    const cityCoverage = Array.from(coverage.entries()).map(([city, entry]) => {
        const sources = Array.from(new Set([...entry.parsers, ...entry.calendarSources])).sort();
        return {
            city, sources, sourceCount: sources.length,
            runSources: Array.from(entry.parsers).sort(), calendarSources: Array.from(entry.calendarSources).sort(),
            events: entry.events, bear: entry.bear, aggregatorEvents: entry.aggregatorEvents, calendarEvents: entry.calendarEvents,
            candidates: rows.filter(row => row.cities.includes(city)).slice(0, 5).map(row => row.key)
        };
    });
    // Cities that exist in the config but saw no event at all this run.
    for (const city of Object.keys(input.cities || {})) {
        if (!coverage.has(city)) cityCoverage.push({ city, sources: [], sourceCount: 0, runSources: [], calendarSources: [], events: 0, bear: 0, aggregatorEvents: 0, calendarEvents: 0, candidates: [] });
    }
    cityCoverage.sort((a, b) => a.sourceCount - b.sourceCount || b.calendarEvents - a.calendarEvents || a.city.localeCompare(b.city));

    return {
        generatedAt: new Date().toISOString(),
        today,
        runId: run.summary && run.summary.runId ? run.summary.runId : '',
        configured: { domains: Array.from(configured.domains.keys()).sort(), organizerPages: Array.from(configured.keys.keys()).sort(), aggregatorHosts: Array.from(configured.aggregatorHosts).sort() },
        candidates: rows,
        cityCoverage,
        instagramOnly: Array.from(socialOnly.values()).map(entry => ({
            handle: entry.handle, events: entry.events.size, cities: Array.from(entry.cities).sort(),
            titles: Array.from(entry.titles), namedBy: Array.from(entry.namedBy).sort()
        })).sort((a, b) => b.events - a.events || a.handle.localeCompare(b.handle)),
        linkHubs: Array.from(hubsSeen.entries()).map(([url, count]) => ({ url, count })).sort((a, b) => b.count - a.count)
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function pad(value, width, right) {
    const text = String(value == null ? '' : value);
    if (text.length >= width) return text.slice(0, width);
    return right ? ' '.repeat(width - text.length) + text : text + ' '.repeat(width - text.length);
}

function renderTable(report, limit) {
    const rows = report.candidates.slice(0, limit);
    const lines = [];
    lines.push(`Source discovery — run ${report.runId || '(none)'} — ${report.candidates.length} unconfigured sites, top ${rows.length}`);
    lines.push(`${pad('#', 3, true)} ${pad('score', 5, true)} ${pad('ev', 4, true)} ${pad('bear', 4, true)} ${pad('cities', 14)} ${pad('latest', 10)} ${pad('site / door', 46)} ${pad('named by', 34)} known as / whose events`);
    rows.forEach((row, index) => {
        const cities = row.cities.length > 3 ? `${row.cities.slice(0, 3).join(',')}+${row.cities.length - 3}` : row.cities.join(',');
        const namedBy = row.aggregators.length ? `agg: ${row.aggregators.join(',')}` : row.namedBy.slice(0, 2).join(',') + (row.namedBy.length > 2 ? ` +${row.namedBy.length - 2}` : '');
        const known = row.knownAs.length ? row.knownAs.join('; ') : row.labels.slice(0, 3).map(entry => `${entry.label} ×${entry.count}`).join(', ');
        lines.push(`${pad(index + 1, 3, true)} ${pad(row.score, 5, true)} ${pad(row.events, 4, true)} ${pad(row.bearEvents, 4, true)} ${pad(cities, 14)} ${pad(row.latest, 10)} ${pad(row.key, 46)} ${pad(namedBy, 34)} ${known}`);
    });
    return lines.join('\n');
}

function renderCoverage(report) {
    const lines = ['', 'Source coverage by city (first-party parsers that produced events there this run; aggregator rows excluded)'];
    lines.push(`${pad('city', 16)} ${pad('src', 3, true)} ${pad('ev', 4, true)} ${pad('agg', 4, true)} ${pad('cal', 4, true)} sources | top candidates`);
    for (const entry of report.cityCoverage) {
        lines.push(`${pad(entry.city, 16)} ${pad(entry.sourceCount, 3, true)} ${pad(entry.events, 4, true)} ${pad(entry.aggregatorEvents, 4, true)} ${pad(entry.calendarEvents, 4, true)} ${entry.sources.join(', ') || '—'} | ${entry.candidates.join(', ') || '—'}`);
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const args = { limit: 40 };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = () => { i += 1; return argv[i]; };
        if (arg === '--run') args.run = next();
        else if (arg === '--json') args.json = next();
        else if (arg === '--min-events') args.minEvents = Number(next());
        else if (arg === '--city') args.city = next();
        else if (arg === '--limit') args.limit = Number(next());
        else if (arg === '--coverage') args.coverage = true;
        else if (arg === '--help' || arg === '-h') args.help = true;
    }
    return args;
}

function loadRepoInputs() {
    const config = require(path.join(repoRoot, 'scripts', 'scraper-input'));
    const parsers = Array.isArray(config.parsers) ? config.parsers : [];
    let cities = {};
    try { cities = require(path.join(repoRoot, 'js', 'city-config')).CITY_CONFIG || {}; } catch (_) { /* optional */ }
    const bars = [];
    const barsDir = path.join(repoRoot, 'data', 'bars');
    try {
        for (const name of fs.readdirSync(barsDir)) {
            if (!name.endsWith('.json')) continue;
            const parsed = readJson(path.join(barsDir, name));
            for (const bar of Array.isArray(parsed) ? parsed : []) bars.push(Object.assign({ city: name.replace(/\.json$/, '') }, bar));
        }
    } catch (_) { /* no bars dir */ }
    const promoters = readJson(path.join(repoRoot, 'data', 'promoters.json')) || [];
    const festivalsFile = readJson(path.join(repoRoot, 'data', 'festivals.json')) || {};
    const festivals = Array.isArray(festivalsFile.festivals) ? festivalsFile.festivals : [];
    return { parsers, cities, bars, promoters, festivals, calendarsDir: path.join(repoRoot, 'data', 'calendars') };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log('usage: node tools/source-discovery.js [--run <run.json>] [--json <out.json>] [--min-events N] [--city <key>] [--limit N] [--coverage]');
        return;
    }
    const runPath = args.run || newestRunFile(path.join(defaultSharedRoot(), 'runs'));
    const run = runPath ? readJson(runPath) : null;
    if (!run) console.log(`(no run file read${runPath ? `: ${runPath}` : ''} — calendars and curated data only)`);
    else console.log(`run: ${runPath}`);
    const inputs = loadRepoInputs();
    const report = discoverSources(Object.assign({ run: run || {}, minEvents: args.minEvents, city: args.city }, inputs));
    console.log(renderTable(report, args.limit));
    if (args.coverage || !args.city) console.log(renderCoverage(report));
    if (report.instagramOnly.length) {
        console.log(`\nInstagram-only presences (no web door anywhere in the data; policy: never fetched): ${report.instagramOnly.length}`);
        for (const entry of report.instagramOnly.slice(0, 25)) console.log(`  @${entry.handle}  ${entry.events} ev  ${entry.cities.join(',')}  ${entry.titles[0] || ''}`);
    }
    if (args.json) {
        fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
        fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
        console.log(`\nwrote ${args.json}`);
    }
}

module.exports = {
    discoverSources, classifyLink, eventLinks, buildConfiguredIndex, isConfigured, configuredOwners, urlPageKey, scoreCandidate,
    collectCalendarEvents, renderTable, renderCoverage, loadSharedCore,
    SOCIAL_HOSTS, LINK_HUB_HOSTS, PLATFORM_DOORS
};

if (require.main === module) {
    try { main(); } catch (error) {
        console.log(`source-discovery failed: ${error && error.stack || error}`);
    }
    process.exitCode = 0;
}

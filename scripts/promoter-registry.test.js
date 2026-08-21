const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildScraperPromotersSource } = require('../tools/generate-scraper-promoters');

const PROMOTERS_JSON_PATH = path.join(__dirname, '..', 'data', 'promoters.json');
const SCRAPER_PROMOTERS_PATH = path.join(__dirname, 'scraper-promoters.js');

// The promoter-name identity key (mirrors SharedCore.normalizePromoterNameKey /
// normalizeBarNameKey): lowercase, drop a leading "the ", strip non-alphanumerics.
function nameKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

function compact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function loadRegistry() {
  return JSON.parse(fs.readFileSync(PROMOTERS_JSON_PATH, 'utf8'));
}

test('promoter registry parses as a flat array of named entries', () => {
  const registry = loadRegistry();
  assert.ok(Array.isArray(registry), 'data/promoters.json must be a flat array');
  assert.ok(registry.length > 0, 'the registry must not be empty');
  for (const entry of registry) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), 'every entry is an object');
    assert.ok(typeof entry.name === 'string' && entry.name.trim(), 'every entry has a non-empty name');
  }
});

test('promoter name keys are unique across the registry (aliases included)', () => {
  const registry = loadRegistry();
  const seen = new Map();
  for (const entry of registry) {
    const keys = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].map(nameKey);
    for (const key of keys) {
      assert.ok(key, `entry "${entry.name}" produced an empty identity key`);
      assert.ok(!seen.has(key), `identity key "${key}" is claimed by both "${seen.get(key)}" and "${entry.name}"`);
      seen.set(key, entry.name);
    }
  }
});

test('parent references resolve to an existing entry name', () => {
  const registry = loadRegistry();
  const names = new Set(registry.map((entry) => entry.name));
  for (const entry of registry) {
    if (entry.parent === undefined) continue;
    assert.ok(typeof entry.parent === 'string' && entry.parent.trim(), `"${entry.name}" has a non-string/empty parent`);
    assert.ok(names.has(entry.parent), `"${entry.name}" points at unknown parent "${entry.parent}"`);
    assert.notEqual(entry.parent, entry.name, `"${entry.name}" cannot be its own parent`);
  }
});

test('bearAffinity is absent or one of the enum values', () => {
  const registry = loadRegistry();
  for (const entry of registry) {
    if (entry.bearAffinity === undefined) continue;
    assert.ok(['always', 'usually'].includes(entry.bearAffinity),
      `"${entry.name}" has invalid bearAffinity "${entry.bearAffinity}"`);
  }
});

test('sub-brand entries carry non-empty keyword lists', () => {
  const registry = loadRegistry();
  for (const entry of registry) {
    if (entry.parent !== undefined) {
      assert.ok(Array.isArray(entry.keywords) && entry.keywords.length > 0,
        `sub-brand "${entry.name}" must declare keywords`);
    }
    if (entry.keywords === undefined) continue;
    assert.ok(Array.isArray(entry.keywords), `"${entry.name}" keywords must be an array`);
    for (const keyword of entry.keywords) {
      assert.ok(typeof keyword === 'string' && keyword.trim(), `"${entry.name}" has an empty keyword`);
    }
  }
});

// Registry hygiene: a urlPatterns entry is promoter evidence, so it must name
// the promoter itself — bare platform hosts (sickening.events, eventbrite.com
// alone, dice.fm, linktr.ee alone) are forbidden.
test('every urlPatterns entry names its own promoter (no bare platform hosts)', () => {
  const registry = loadRegistry();
  for (const entry of registry) {
    if (entry.urlPatterns === undefined) continue;
    assert.ok(Array.isArray(entry.urlPatterns) && entry.urlPatterns.length > 0,
      `"${entry.name}" urlPatterns must be a non-empty array when present`);
    const ownTokens = [
      nameKey(entry.name),
      ...(Array.isArray(entry.aliases) ? entry.aliases.map(nameKey) : []),
      compact(String(entry.instagram || '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')),
      compact(String(entry.website || '').replace(/^https?:\/\/(www\.)?/i, ''))
    ].filter((token) => token && token.length >= 4);
    for (const pattern of entry.urlPatterns) {
      assert.ok(typeof pattern === 'string' && pattern.trim(), `"${entry.name}" has an empty urlPatterns entry`);
      const patternCompact = compact(pattern);
      assert.ok(ownTokens.some((token) => patternCompact.includes(token)),
        `"${entry.name}" urlPatterns entry "${pattern}" does not name the promoter — bare platform hosts are forbidden as promoter evidence`);
    }
  }
});

test('scripts/scraper-promoters.js is the in-sync twin of data/promoters.json', () => {
  const registry = loadRegistry();
  const expected = buildScraperPromotersSource(registry);
  const actual = fs.readFileSync(SCRAPER_PROMOTERS_PATH, 'utf8');
  assert.equal(actual, expected,
    'scripts/scraper-promoters.js is stale — run `node tools/generate-scraper-promoters.js`');
});

test('the generated twin exports the same registry object', () => {
  const registry = loadRegistry();
  const twin = require('./scraper-promoters');
  assert.deepEqual(twin, registry);
});

// Run 20260728-113040: the title "CUBSCOUT" failed to match because padded
// title containment needs the full "cubscoutla" key. The same-entry alias
// "CUBSCOUT" fixes it — and the matcher's generic-stem guard only refuses
// keys contained in OTHER entries' keys, so an alias that is a substring of
// its own entry's name key stays matchable.
test('CubScout LA carries the CUBSCOUT alias and passes registry hygiene', () => {
  const registry = loadRegistry();
  const entry = registry.find((candidate) => candidate.name === 'CubScout LA');
  assert.ok(entry, 'CubScout LA entry exists');
  assert.ok(Array.isArray(entry.aliases) && entry.aliases.includes('CUBSCOUT'),
    'the CUBSCOUT alias is present');
  // The alias key must be claimed by no other entry (the uniqueness test
  // covers the general rule; this pins the specific pair).
  const claimants = registry.filter((candidate) =>
    [candidate.name, ...(Array.isArray(candidate.aliases) ? candidate.aliases : [])]
      .some((name) => nameKey(name) === 'cubscout'));
  assert.deepEqual(claimants.map((candidate) => candidate.name), ['CubScout LA']);
});

test('matcher: the title "CUBSCOUT" matches CubScout LA via the same-entry alias', () => {
  const { SharedCore } = require('./shared-core');
  const { EventSchema } = require('./event-schema');
  const core = new SharedCore({}, { eventSchema: EventSchema, promoters: loadRegistry() });
  const match = core.matchEventToPromoter({ title: 'CUBSCOUT' });
  assert.ok(match && match.entry, `expected a match, got ${JSON.stringify(match)}`);
  assert.equal(match.entry.name, 'CubScout LA');
  assert.equal(match.evidence, 'title');
  // The full name still matches too.
  const fullName = core.matchEventToPromoter({ title: 'CubScout LA: Woof Edition' });
  assert.ok(fullName && fullName.entry && fullName.entry.name === 'CubScout LA');
});

test('matcher: MEGAWOOF alias and the new BEEFMINCE sub-brands match their titles', () => {
  const { SharedCore } = require('./shared-core');
  const { EventSchema } = require('./event-schema');
  const core = new SharedCore({}, { eventSchema: EventSchema, promoters: loadRegistry() });
  // Battery run 20260728 (The Bear Calendar): "MEGAWOOF HOUSTON @ RICHs"
  // carried no registry evidence — only the full "Megawoof America" name was
  // known. The same-entry substring alias closes the recall gap.
  const megawoof = core.matchEventToPromoter({ title: 'MEGAWOOF HOUSTON @ RICHs' });
  assert.ok(megawoof && megawoof.entry, `expected a match, got ${JSON.stringify(megawoof)}`);
  assert.equal(megawoof.entry.name, 'Megawoof America');
  assert.equal(megawoof.evidence, 'title');

  const spook = core.matchEventToPromoter({ title: 'SPOOKMINCE' });
  assert.ok(spook && spook.entry, `expected a match, got ${JSON.stringify(spook)}`);
  assert.equal(spook.entry.name, 'SPOOKMINCE');
  assert.equal(spook.entry.parent, 'BEEFMINCE');

  const boat = core.matchEventToPromoter({ title: 'BOATMINCE — September 2026' });
  assert.ok(boat && boat.entry, `expected a match, got ${JSON.stringify(boat)}`);
  assert.equal(boat.entry.name, 'BOATMINCE');
  assert.equal(boat.entry.parent, 'BEEFMINCE');
});

// ── Promoters own identity (2026-07 migration) ─────────────────────────────
// Identity metadata (shortName/socials/matchKey/favicon) and bear trust
// (bearAffinity) moved OUT of parser configs into this registry. A parser
// entry whose name (or a registry alias of it) IS a curated promoter identity
// must be a pure source: no metadata block, no alwaysBear. Venue parsers
// (Dallas Eagle, 3 Dollar Bill, The Lumberyard, massive.club) are not
// registry identities and keep their venue-fact metadata untouched.
test('repo scraper-input: registry-identity parsers carry no metadata or alwaysBear', () => {
  const registry = loadRegistry();
  const registryKeys = new Set();
  for (const entry of registry) {
    for (const name of [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]) {
      registryKeys.add(nameKey(name));
    }
  }
  const { parsers } = require('./scraper-input');
  const promoterParsers = parsers.filter((parser) => registryKeys.has(nameKey(parser.name)));
  // Floor guards against the filter silently matching nothing. It dropped from
  // 15 to 14 when the "CubScout LA" PARSER became the "Eagle LA" venue parser
  // (eaglela.com is a venue site hosting many parties, not one promoter's
  // page). The CubScout LA promoter ENTRY is untouched and still claims the
  // CUBSCOUT alias — see the alias tests above.
  assert.ok(promoterParsers.length >= 14,
    `expected at least the 14 migrated promoter parsers, found ${promoterParsers.length}`);
  // A venue parser must never be treated as a promoter parser: "Eagle LA" is a
  // curated BAR (data/bars/la.json), so it must not appear in this set — that
  // is what makes the count 14 rather than a silently weakened floor.
  assert.ok(!promoterParsers.some((parser) => nameKey(parser.name) === nameKey('Eagle LA')),
    'the Eagle LA venue parser must not be classified as a promoter parser');
  for (const parser of promoterParsers) {
    assert.ok(!('metadata' in parser),
      `promoter parser "${parser.name}" must not carry metadata — promoter identity lives in data/promoters.json`);
    assert.ok(!('alwaysBear' in parser),
      `promoter parser "${parser.name}" must not carry alwaysBear — set bearAffinity in data/promoters.json`);
  }
});

// Registry-application parity for a migrated field that previously lived only
// in the parser config: Furball's favicon. On match the registry must stamp
// the exact facts the old config metadata stamped, through the same static
// machinery, and the removed parser-level alwaysBear must be replaced by the
// entry's bearAffinity trust.
test('migrated Furball identity (incl. favicon) stamps on match exactly like the old parser metadata', () => {
  const { SharedCore } = require('./shared-core');
  const { EventSchema } = require('./event-schema');
  const core = new SharedCore({}, { eventSchema: EventSchema, promoters: loadRegistry() });
  const enforceConfig = { config: { promoterRegistry: { mode: 'enforce' } } };
  const event = { title: 'FURBALL Chicago', startDate: new Date('2026-08-01T21:00:00.000Z') };
  core.applyPromoterRegistryMatches([event], { name: 'Furball' }, enforceConfig);
  assert.equal(event._promoter, 'Furball');
  // The exact values the removed parser-config metadata block used to stamp
  assert.equal(event.shortName, 'FUR\u00adBALL');
  assert.equal(event.instagram, 'https://instagram.com/furballnyc/');
  // url/website are ONE canonical field now: the registry stamps no distinct
  // `url` value — canonicalizeIdentityLinks fills the blank `website` from
  // the entry's identity link instead.
  assert.equal(event.url, undefined, 'url never exists as a distinct stored value');
  core.canonicalizeIdentityLinks([event]);
  assert.equal(event.website, 'https://www.furball.nyc', 'identity ladder fills the blank website');
  assert.equal(event.favicon, 'https://linktr.ee/furballnyc', 'favicon migrated into the registry');
  // Same static machinery: stamped fields are tracked for de-circularization
  assert.equal(event._staticFields.favicon, 'https://linktr.ee/furballnyc');
  assert.equal(event._staticFields.shortName, 'FUR\u00adBALL');
  // Bear trust now comes from the entry, with the parser carrying no alwaysBear
  const trust = core.getEventBearTrust(event, { name: 'Furball' });
  assert.equal(trust.trusted, true);
  assert.equal(trust.affinity, 'always');
});

// The other config-only facts found by the migration inventory: Bears Sitges
// Week's shortName moved onto Bears Sitges Club, and Spooky Bear became a
// sub-brand of Northeast Ursamen carrying its old config identity (shortName,
// spookybear website, explicit always-trust); socials inherit from the parent.
test('migrated festival identities: Bears Sitges shortName and the Spooky Bear sub-brand', () => {
  const { SharedCore } = require('./shared-core');
  const { EventSchema } = require('./event-schema');
  const core = new SharedCore({}, { eventSchema: EventSchema, promoters: loadRegistry() });
  const sitges = core.matchEventToPromoter({ title: 'Bears Sitges Week — Opening Party' });
  assert.ok(sitges && sitges.entry, `expected a Sitges match, got ${JSON.stringify(sitges)}`);
  assert.equal(sitges.entry.name, 'Bears Sitges Club');
  assert.equal(core.promoterEntryToMetadataBlock(sitges.entry).shortName.value, 'BEARS SITGES');

  const spooky = core.matchEventToPromoter({ title: 'SPOOKY BEAR 2026 Kickoff' });
  assert.ok(spooky && spooky.entry, `expected a Spooky Bear match, got ${JSON.stringify(spooky)}`);
  assert.equal(spooky.entry.name, 'Spooky Bear');
  assert.equal(spooky.entry.parent, 'Northeast Ursamen');
  const block = core.promoterEntryToMetadataBlock(spooky.entry);
  assert.equal(block.shortName.value, 'SPOOKY BEAR');
  // url/website are ONE canonical field: the identity link is no longer a
  // static block stamp (that minted a distinct `url` value on every matched
  // event) — it is carried by getPromoterEntryIdentityWebsite and applied to
  // `website` by canonicalizeIdentityLinks.
  assert.equal(block.url, undefined, 'no url key in the static block — url never exists as a stored field');
  assert.equal(core.getPromoterEntryIdentityWebsite(spooky.entry), 'https://www.ursamen.org/spookybear');
  assert.equal(block.instagram.value, 'https://www.instagram.com/ne.ursamen', 'inherited from Northeast Ursamen');
  assert.equal(block.facebook.value, 'https://www.facebook.com/NEUrsamen', 'inherited from Northeast Ursamen');
  assert.equal(spooky.entry.bearAffinity, 'always',
    'sub-brand carries explicit always-trust now that the parser has no alwaysBear');
});

test('matcher: statically stamped url-ish fields are never registry evidence (de-circularization)', () => {
  const { SharedCore } = require('./shared-core');
  const { EventSchema } = require('./event-schema');
  const core = new SharedCore({}, { eventSchema: EventSchema, promoters: loadRegistry() });
  // Battery run 20260728 (Club Chub): the parser's own static metadata
  // stamped instagram.com/clubchubparty onto every event it emitted, and
  // DURO then "matched" Club Chub on the parser's own stamp — circular.
  const stamped = core.matchEventToPromoter({
    title: 'D>U>R>O is back NEW OUTDOOR LOCATION',
    instagram: 'https://www.instagram.com/clubchubparty',
    _staticFields: { instagram: 'https://www.instagram.com/clubchubparty' }
  });
  assert.equal(stamped, null, 'a parser-stamped instagram is not evidence');
  // The SAME event with the instagram organically extracted (no
  // _staticFields entry) still matches.
  const organic = core.matchEventToPromoter({
    title: 'D>U>R>O is back NEW OUTDOOR LOCATION',
    instagram: 'https://www.instagram.com/clubchubparty'
  });
  assert.ok(organic && organic.entry, `expected an organic match, got ${JSON.stringify(organic)}`);
  assert.equal(organic.entry.name, 'Club Chub');
  assert.equal(organic.evidence, 'url:instagram.com/clubchubparty');
});

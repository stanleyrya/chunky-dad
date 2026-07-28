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

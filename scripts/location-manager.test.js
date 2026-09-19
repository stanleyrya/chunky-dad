const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// js/location-manager.js is browser code; it runs here in a sandbox with an
// in-memory localStorage and a scripted navigator.geolocation.
function loadManager({ permission = 'granted', position = null, error = null, cached = null, now = Date.now() } = {}) {
  const store = new Map();
  if (cached) store.set('chunky_dad_location_cache', JSON.stringify({ lat: cached.lat, lng: cached.lng, accuracy: 30, timestamp: now - cached.ageMs }));
  const calls = [];
  const sandbox = {
    console: { info() {}, debug() {}, warn() {}, error() {}, log() {} },
    Date: { now: () => now },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    sessionStorage: { setItem() {}, removeItem() {} },
    navigator: {
      geolocation: {
        getCurrentPosition(ok, fail, options) {
          calls.push(options);
          if (position) ok({ coords: { latitude: position.lat, longitude: position.lng, accuracy: 10 } });
          else fail({ code: error || 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' });
        }
      },
      permissions: { query: async () => ({ state: permission }) }
    },
    Math, JSON, Promise, Error, Number, Boolean, String
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'location-manager.js'), 'utf8'), sandbox);
  return { manager: new sandbox.window.LocationManager(), calls, store };
}

const ICELAND = { lat: 64.1466, lng: -21.9426 };
const SITGES = { lat: 41.2372, lng: 1.8059 };

test('a stale cached fix is never the answer: the browser is asked, and the new fix replaces it', async () => {
  const { manager, calls, store } = loadManager({ cached: { ...ICELAND, ageMs: 5 * 24 * 3600000 }, position: SITGES });
  const loc = await manager.getCurrentLocation();
  assert.equal(calls.length, 1, 'getCurrentPosition called');
  assert.deepEqual([loc.lat, loc.lng, loc.source, loc.stale], [SITGES.lat, SITGES.lng, 'gps', false]);
  assert.equal(JSON.parse(store.get('chunky_dad_location_cache')).lat, SITGES.lat, 'cache updated');
});

test('a fresh cached fix (under an hour) answers without asking; a forced refresh asks anyway with maximumAge 0', async () => {
  const { manager, calls } = loadManager({ cached: { ...SITGES, ageMs: 10 * 60000 }, position: ICELAND });
  const loc = await manager.getCurrentLocation();
  assert.equal(calls.length, 0);
  assert.equal(loc.source, 'cache');
  const forced = await manager.getCurrentLocation({}, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maximumAge, 0, "the browser's own cached position is refused too");
  assert.equal(forced.source, 'gps');
});

test('when the request fails, the old fix is only a marked fallback', async () => {
  const { manager } = loadManager({ cached: { ...ICELAND, ageMs: 3 * 24 * 3600000 }, position: null, error: 1 });
  const loc = await manager.getCurrentLocation({}, true);
  assert.deepEqual([loc.lat, loc.source, loc.stale], [ICELAND.lat, 'cache_fallback', true]);
  assert.ok(loc.ageMs > 2 * 24 * 3600000);
  const none = loadManager({ position: null, error: 1 });
  await assert.rejects(() => none.manager.getCurrentLocation({}, true), /denied/);
});

test('silent page-load path: refreshes a stale fix only when the browser already granted; otherwise serves it marked stale, no prompt; the map button always asks', async () => {
  const granted = loadManager({ permission: 'granted', cached: { ...ICELAND, ageMs: 2 * 3600000 }, position: SITGES });
  const fresh = await granted.manager.getLocationForFeatures();
  assert.equal(granted.calls.length, 1);
  assert.equal(fresh.lat, SITGES.lat);

  const prompt = loadManager({ permission: 'prompt', cached: { ...ICELAND, ageMs: 2 * 3600000 }, position: SITGES });
  const stale = await prompt.manager.getLocationForFeatures();
  assert.equal(prompt.calls.length, 0, 'no request without a grant → no prompt on load');
  assert.deepEqual([stale.lat, stale.stale], [ICELAND.lat, true]);

  const map = loadManager({ permission: 'prompt', cached: { ...ICELAND, ageMs: 2 * 3600000 }, position: SITGES });
  const pressed = await map.manager.getLocationForMap(false);
  assert.equal(map.calls.length, 1, 'the map button always asks');
  assert.equal(pressed.lat, SITGES.lat);
});

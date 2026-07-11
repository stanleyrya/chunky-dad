const test = require('node:test');
const assert = require('node:assert/strict');

const { LocationNormalizer } = require('./normalizers');
const { SharedCore } = require('./shared-core');
const { EventSchema } = require('./event-schema');

const CITIES = {
  nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] }
};

function createLocationNormalizer() {
  const core = new SharedCore(CITIES, { eventSchema: EventSchema });
  return new LocationNormalizer(core);
}

test('resolveWallClockDates re-anchors flagged dates once the city timezone is known', () => {
  const normalizer = createLocationNormalizer();
  const event = {
    title: 'UNDERBEAR',
    city: 'nyc',
    // Wall-clock 10pm local stored as 10pm UTC by the parser's timezone-less fallback
    startDate: new Date('2026-07-17T22:00:00.000Z'),
    endDate: new Date('2026-07-17T22:00:00.000Z'),
    _timezoneUnresolved: true
  };

  normalizer.resolveWallClockDates(event);

  // 10pm EDT (UTC-4) is 2am UTC the next day
  assert.equal(event.startDate.toISOString(), '2026-07-18T02:00:00.000Z');
  assert.equal(event.endDate.toISOString(), '2026-07-18T02:00:00.000Z');
  assert.equal(event.timezone, 'America/New_York');
  assert.equal(event._timezoneUnresolved, undefined);
});

test('resolveWallClockDates preserves ISO string date types', () => {
  const normalizer = createLocationNormalizer();
  const event = {
    title: 'UNDERBEAR',
    city: 'nyc',
    startDate: '2026-07-17T22:00:00.000Z',
    endDate: '2026-07-17T22:00:00.000Z',
    _timezoneUnresolved: true
  };

  normalizer.resolveWallClockDates(event);

  assert.equal(event.startDate, '2026-07-18T02:00:00.000Z');
  assert.equal(typeof event.startDate, 'string');
});

test('resolveWallClockDates leaves dates untouched when the timezone stays unknown', () => {
  const normalizer = createLocationNormalizer();
  const event = {
    title: 'MYSTERY EVENT',
    city: 'unknown',
    startDate: new Date('2026-07-17T22:00:00.000Z'),
    endDate: new Date('2026-07-17T22:00:00.000Z'),
    _timezoneUnresolved: true
  };

  normalizer.resolveWallClockDates(event);

  assert.equal(event.startDate.toISOString(), '2026-07-17T22:00:00.000Z');
  assert.equal(event._timezoneUnresolved, true, 'flag should remain so the gap stays visible');
});

test('resolveWallClockDates ignores events without the wall-clock flag', () => {
  const normalizer = createLocationNormalizer();
  const event = {
    title: 'ALREADY ANCHORED',
    city: 'nyc',
    startDate: new Date('2026-07-18T02:00:00.000Z')
  };

  normalizer.resolveWallClockDates(event);

  assert.equal(event.startDate.toISOString(), '2026-07-18T02:00:00.000Z');
  assert.equal(event.timezone, undefined);
});

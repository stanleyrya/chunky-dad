const test = require('node:test');
const assert = require('node:assert');
const { computeCityActivity, isActive, rruleUntil } = require('../tools/generate-city-activity.js');

const TODAY = '2026-09-04';
const cityConfig = { nyc: {}, atlanta: {}, ptown: {}, dallas: {}, nocal: {} };

function cal(events) { return { metadata: {}, events }; }

test('a city with only past single events and no festival is quiet', () => {
    const cities = computeCityActivity({
        cityConfig,
        calendars: { atlanta: cal([{ startDate: '2026-08-01T20:00:00' }, { startDate: '2026-09-03T20:00:00' }]) },
        festivals: [],
        today: TODAY
    });
    assert.deepStrictEqual(cities.atlanta, { dates: [], recurring: 0, festivalUntil: null });
    assert.strictEqual(isActive(cities.atlanta, TODAY), false);
});

test('future single events keep a city active, listed as sorted unique dates', () => {
    const cities = computeCityActivity({
        cityConfig,
        calendars: { nyc: cal([
            { startDate: '2026-09-20T20:00:00' },
            { startDate: '2026-09-04T22:00:00' },
            { startDate: '2026-09-20T23:00:00' }
        ]) },
        festivals: [],
        today: TODAY
    });
    assert.deepStrictEqual(cities.nyc.dates, ['2026-09-04', '2026-09-20']);
    assert.strictEqual(isActive(cities.nyc, TODAY), true);
    // the browser re-evaluates against ITS today: once both dates pass, quiet
    assert.strictEqual(isActive(cities.nyc, '2026-09-21'), false);
});

test('an open-ended recurring event keeps a city active; an expired UNTIL does not', () => {
    const cities = computeCityActivity({
        cityConfig,
        calendars: {
            nyc: cal([{ recurring: true, recurrence: 'FREQ=MONTHLY;BYDAY=1SA', startDate: '2025-07-05T22:00:00' }]),
            atlanta: cal([{ recurring: true, recurrence: 'FREQ=WEEKLY;UNTIL=20260101T000000Z', startDate: '2025-07-05T22:00:00' }])
        },
        festivals: [],
        today: TODAY
    });
    assert.strictEqual(cities.nyc.recurring, 1);
    assert.strictEqual(isActive(cities.nyc, TODAY), true);
    assert.strictEqual(cities.atlanta.recurring, 0);
    assert.strictEqual(isActive(cities.atlanta, TODAY), false);
    assert.strictEqual(rruleUntil('FREQ=WEEKLY;UNTIL=20260101T000000Z'), '2026-01-01');
});

test('an upcoming festival keeps an otherwise empty city active until the festival ends', () => {
    const cities = computeCityActivity({
        cityConfig,
        calendars: { ptown: cal([]), dallas: cal([]) },
        festivals: [
            { key: 'spooky-bear', cityKey: 'ptown', nextDates: { start: '2026-10-29', end: '2026-11-01' } },
            { key: 'tbru', cityKey: 'dallas', nextDates: { start: '2027-03-18', end: '2027-03-21' } },
            { key: 'undated', cityKey: 'dallas' }
        ],
        today: TODAY
    });
    assert.strictEqual(cities.ptown.festivalUntil, '2026-11-01');
    assert.strictEqual(isActive(cities.ptown, TODAY), true);
    assert.strictEqual(isActive(cities.ptown, '2026-11-02'), false);
    assert.strictEqual(cities.dallas.festivalUntil, '2027-03-21');
});

test('a city without a processed calendar is not listed, and an unlisted city counts as active', () => {
    const cities = computeCityActivity({ cityConfig, calendars: {}, festivals: [], today: TODAY });
    assert.strictEqual(Object.keys(cities).length, 0);
    assert.strictEqual(isActive(undefined, TODAY), true);
});

test('festivals.json wrapped in an object is accepted too', () => {
    const cities = computeCityActivity({
        cityConfig,
        calendars: { ptown: cal([]) },
        festivals: { festivals: [{ cityKey: 'ptown', nextDates: { start: '2026-10-29', end: '2026-11-01' } }] },
        today: TODAY
    });
    assert.strictEqual(cities.ptown.festivalUntil, '2026-11-01');
});

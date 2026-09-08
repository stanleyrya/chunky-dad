const test = require('node:test');
const assert = require('node:assert');
const { buildPlateIndex, hostOf } = require('../tools/generate-event-plates.js');

test('a plate is keyed by the website domain, www stripped and lowercased', () => {
    const idx = buildPlateIndex([
        { url: 'https://WWW.Southerndecadence.com/', faviconPlate: '#FFFFFF' },
        { url: 'https://folsomeurope.berlin/', faviconPlate: '#000000' }
    ]);
    assert.deepStrictEqual(idx, { 'southerndecadence.com': '#ffffff', 'folsomeurope.berlin': '#000000' });
    assert.strictEqual(hostOf('https://www.theurbanbear.com/urbanbearnyc'), 'theurbanbear.com');
});

test('the first entry for a domain wins, so repeated runs are stable', () => {
    const idx = buildPlateIndex([
        { url: 'https://eagle.example/one', faviconPlate: '#000000' },
        { url: 'https://eagle.example/two', faviconPlate: '#ff0000' }
    ]);
    assert.strictEqual(idx['eagle.example'], '#000000');
});

test('entries without a url, without a plate, or with a junk plate are skipped', () => {
    const idx = buildPlateIndex([
        { faviconPlate: '#ffffff' },
        { url: 'https://a.example/' },
        { url: 'not a url', faviconPlate: '#ffffff' },
        { url: 'https://b.example/', faviconPlate: 'rgb(1,2,3)' },
        { url: 'https://c.example/', faviconPlate: '#abc' }
    ]);
    assert.deepStrictEqual(idx, { 'c.example': '#abc' });
});

test('no entries yields an empty index rather than throwing', () => {
    assert.deepStrictEqual(buildPlateIndex([]), {});
    assert.deepStrictEqual(buildPlateIndex(undefined), {});
});

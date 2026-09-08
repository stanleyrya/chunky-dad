const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    shouldHaveCard,
    cardRelPath,
    cityCardRelPath,
    homeCardRelPath,
    buildFlyerIndex,
    localFlyerFor,
    CARD_GRACE_DAYS
} = require('../tools/og-policy.js');

const NOW = new Date('2026-09-08T12:00:00Z');
const daysBefore = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const daysAfter = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

test('a recurring event always keeps its card — one dateless image serves every occurrence', () => {
    // its series start can be years back; that must not expire the card
    assert.strictEqual(shouldHaveCard({ recurring: true }, daysBefore(800), NOW), true);
});

test('a one-off keeps its card while upcoming and through the grace period, then loses it', () => {
    assert.strictEqual(shouldHaveCard({ recurring: false }, daysAfter(30), NOW), true);
    assert.strictEqual(shouldHaveCard({ recurring: false }, daysBefore(1), NOW), true);
    assert.strictEqual(shouldHaveCard({ recurring: false }, daysBefore(CARD_GRACE_DAYS - 1), NOW), true);
    assert.strictEqual(shouldHaveCard({ recurring: false }, daysBefore(CARD_GRACE_DAYS + 5), NOW), false);
});

test('an undated event keeps its card — we cannot prove it is over', () => {
    assert.strictEqual(shouldHaveCard({ recurring: false }, null, NOW), true);
    assert.strictEqual(shouldHaveCard({ recurring: false }, new Date('nonsense'), NOW), true);
});

test('nothing at all gets no card', () => {
    assert.strictEqual(shouldHaveCard(null, null, NOW), false);
});

test('card paths are .jpg and slugs are URL-encoded', () => {
    assert.strictEqual(cardRelPath('nyc', 'beer-blast-15963ca2'), '/img/og/nyc/beer-blast-15963ca2.jpg');
    assert.strictEqual(cityCardRelPath('nyc'), '/img/og/city/nyc.jpg');
    assert.strictEqual(homeCardRelPath(), '/img/og/home.jpg');
    assert.ok(cardRelPath('nyc', 'a b').endsWith('a%20b.jpg'));
});

test('a flyer resolves to its local copy by the URL its .meta sidecar records', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-policy-'));
    const image = path.join(dir, '2026-07-04_party_2b155a53.jpg');
    fs.writeFileSync(image, 'jpeg');
    fs.writeFileSync(image + '.meta', JSON.stringify({
        originalUrl: 'https://cdn.example/poster.jpg',
        adjustedUrl: 'https://cdn.example/poster.jpg?w=1240'
    }));

    const index = buildFlyerIndex(dir);
    assert.strictEqual(localFlyerFor('https://cdn.example/poster.jpg', index), image);
    // the host-adjusted variant points at the same file
    assert.strictEqual(localFlyerFor('https://cdn.example/poster.jpg?w=1240', index), image);
    assert.strictEqual(localFlyerFor('https://cdn.example/other.jpg', index), '');
    assert.strictEqual(localFlyerFor('', index), '');
});

test('a flyer with no sidecar still resolves through the hash in its filename', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-policy-'));
    fs.writeFileSync(path.join(dir, '2026-07-04_party_2b155a53.jpg'), 'jpeg');
    const index = buildFlyerIndex(dir);
    // the caller supplies the same hash function download-images.js named the file with
    assert.strictEqual(
        localFlyerFor('https://cdn.example/poster.jpg', index, () => '2b155a53'),
        path.join(dir, '2026-07-04_party_2b155a53.jpg')
    );
});

test('rail thumbnails are never offered as a card flyer', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-policy-'));
    fs.writeFileSync(path.join(dir, '2026-07-04_party_aaaaaaaa-thumb.webp'), 'webp');
    const index = buildFlyerIndex(dir);
    assert.strictEqual(localFlyerFor('x', index, () => 'aaaaaaaa'), '');
});

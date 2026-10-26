// tools/review-outbox.js — swipes that wait for the Mac.
const test = require('node:test');
const assert = require('node:assert');

const ReviewOutbox = require('../tools/review-outbox.js');

function fakeStorage() {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), map };
}
const offline = () => Promise.reject(new TypeError('Load failed'));
const refused = (msg) => Promise.reject(new Error(msg));
const ok = () => Promise.resolve({ ok: true });

test('a network failure keeps the swipe (order, timestamp) and answers as queued; a server refusal is thrown as before', async () => {
    const storage = fakeStorage();
    const sent = [];
    let mode = 'offline';
    const box = ReviewOutbox.create({ storage, send: (path, body) => { sent.push([path, body.key]); return mode === 'offline' ? offline() : mode === 'refuse' ? refused('bad key') : ok(); } });
    const changes = [];
    box.onChange((n) => changes.push(n));
    const first = await box.post('/review/decide', { key: 'event|a', verdict: 'approve' });
    assert.deepEqual(first, { ok: true, queued: true });
    assert.equal(box.size(), 1);
    assert.deepEqual(box.keys(), { 'event|a': true });
    assert.match(box.entries()[0].at, /^\d{4}-/);
    mode = 'refuse';
    await assert.rejects(box.post('/review/bear', { key: 'event|b', verdict: 'bear' }), /bad key/, 'an answer from the Mac is not queued');
    // but the refused attempt first tried to flush the waiting one, which was refused too and dropped
    assert.deepEqual(changes, [1, 0]);
});

test('post while entries wait: flush first, in order, then the new one — a decision never overtakes an earlier one on the same key', async () => {
    const storage = fakeStorage();
    const sent = [];
    let online = false;
    const box = ReviewOutbox.create({ storage, send: (path, body) => { if (!online) return offline(); sent.push(body.key + ':' + body.verdict); return ok(); } });
    await box.post('/review/decide', { key: 'k1', verdict: 'approve' });
    await box.post('/review/decide', { key: 'k2', verdict: 'reject' });
    await box.post('/review/decide', { key: 'k1', verdict: 'clear' });
    assert.equal(box.size(), 3);
    assert.deepEqual(box.entries().map((e) => e.body.key + ':' + e.body.verdict), ['k1:approve', 'k2:reject', 'k1:clear']);
    online = true;
    const direct = await box.post('/review/decide', { key: 'k3', verdict: 'approve' });
    assert.deepEqual(direct, { ok: true });
    assert.deepEqual(sent, ['k1:approve', 'k2:reject', 'k1:clear', 'k3:approve'], 'the waiting ones went first, oldest first');
    assert.equal(box.size(), 0);
    assert.equal(storage.getItem(ReviewOutbox.KEY), null, 'nothing left in storage');
});

test('flush stops at the first network failure and keeps the rest; a refusal drops that entry, reports it, and goes on', async () => {
    const storage = fakeStorage();
    const refusedOnes = [];
    const answers = { a: ok, b: () => refused('no such card'), c: ok };
    let cOffline = true;
    const box = ReviewOutbox.create({ storage, send: (path, body) => (body.key === 'c' && cOffline ? offline() : answers[body.key]()), onRefused: (entry, error) => refusedOnes.push(entry.body.key + ' ' + error.message) });
    storage.setItem(ReviewOutbox.KEY, JSON.stringify([
        { path: '/review/decide', body: { key: 'a', verdict: 'approve' }, at: 't' },
        { path: '/review/decide', body: { key: 'b', verdict: 'approve' }, at: 't' },
        { path: '/review/decide', body: { key: 'c', verdict: 'approve' }, at: 't' }
    ]));
    const pass1 = await box.flush();
    assert.deepEqual(pass1, { sent: 1, waiting: 1, blocked: true });
    assert.deepEqual(refusedOnes, ['b no such card']);
    assert.deepEqual(box.keys(), { c: true });
    cOffline = false;
    const pass2 = await box.flush();
    assert.deepEqual(pass2, { sent: 1, waiting: 0 });
    assert.equal(await box.flush().then((r) => r.sent), 0, 'an empty flush is a no-op');
});

test('drop removes every waiting entry for a key (the undo of a swipe that never left), concurrent flushes share one pass, and bad storage reads as empty', async () => {
    const storage = fakeStorage();
    const box = ReviewOutbox.create({ storage, send: offline });
    await box.post('/review/decide', { key: 'x', verdict: 'reject' });
    await box.post('/review/bear', { key: 'x', verdict: 'not_bear' });
    await box.post('/review/decide', { key: 'y', verdict: 'approve' });
    assert.equal(box.drop('x'), 2);
    assert.deepEqual(box.keys(), { y: true });
    const [p1, p2] = [box.flush(), box.flush()];
    assert.strictEqual(p1, p2, 'one flush at a time');
    await p1;
    storage.setItem(ReviewOutbox.KEY, '{not json');
    assert.deepEqual(box.entries(), []);
    assert.equal(box.size(), 0);
});

test('isNetworkFailure: the browser shapes, not a server answer', () => {
    assert.equal(ReviewOutbox.isNetworkFailure(new TypeError('Failed to fetch')), true);
    assert.equal(ReviewOutbox.isNetworkFailure(new Error('Load failed')), true);
    assert.equal(ReviewOutbox.isNetworkFailure(new Error('The network connection was lost.')), true);
    assert.equal(ReviewOutbox.isNetworkFailure(new Error('HTTP 500')), false);
    assert.equal(ReviewOutbox.isNetworkFailure(new Error('unknown key')), false);
    assert.equal(ReviewOutbox.isNetworkFailure(null), false);
});

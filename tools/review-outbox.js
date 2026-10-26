// Swipes that wait — the review deck's outbox (served at /review-outbox.js).
//
// A swipe posts its decision to the Mac. In a tunnel, or with the VPN down,
// that post fails with a network error (never an answer from the server).
// Before this, the card went back on the stack with "Not saved" and the
// swipe was lost. Now the decision is kept in the browser, in order, and
// sent when the Mac answers again: on the next swipe, when the browser says
// it is back online, when the page is brought back to the front, and every
// half minute meanwhile. Order holds: while anything waits, a new swipe
// queues behind it rather than overtaking it — two decisions on one key
// must land in the order they were made.
//
// An answer from the Mac that refuses a waiting swipe (a 4xx/5xx with a
// message) is final: that entry is dropped and reported, the rest go on.
//
// No dependencies, no modules, ES5 — the oldest phone Safari runs it. The
// same file loads in Node for the test (scripts/review-outbox.test.js),
// with a storage object passed in.
(function (root) {
  'use strict';
  var KEY = 'chunky-deck-outbox';

  // fetch() rejects with a TypeError when the network is gone; a server
  // answer is an Error with a message from the body or the status.
  function isNetworkFailure(error) {
    if (!error) return false;
    if (typeof TypeError === 'function' && error instanceof TypeError) return true;
    return /Load failed|Failed to fetch|NetworkError|network connection was lost|The Internet connection appears to be offline|network wait over/i.test(String(error.message || error));
  }

  function create(options) {
    options = options || {};
    var storage = options.storage || root.localStorage;
    var send = options.send;
    var listeners = [];
    var flushing = null;

    function read() {
      try { var v = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    }
    function write(list) {
      try { if (list.length) storage.setItem(KEY, JSON.stringify(list)); else storage.removeItem(KEY); } catch (e) { /* storage full or blocked: the swipe is lost like before, and the caller is told below */ }
      var n = read().length;
      for (var i = 0; i < listeners.length; i++) { try { listeners[i](n); } catch (e) { /* a listener must not break the queue */ } }
    }
    function attempt(path, body) {
      return send(path, body).then(null, function (error) {
        if (!isNetworkFailure(error)) throw error;
        var list = read();
        list.push({ path: path, body: body, at: new Date().toISOString() });
        write(list);
        if (!read().length) throw error; // could not even keep it
        return { ok: true, queued: true };
      });
    }
    // One at a time, oldest first. A network failure stops the pass and
    // keeps everything; a refusal drops that one entry and continues.
    function step(sent) {
      var list = read();
      if (!list.length) return Promise.resolve({ sent: sent, waiting: 0 });
      var next = list[0];
      return send(next.path, next.body).then(function () {
        write(read().slice(1));
        return step(sent + 1);
      }, function (error) {
        if (isNetworkFailure(error)) return { sent: sent, waiting: read().length, blocked: true };
        write(read().slice(1));
        if (options.onRefused) { try { options.onRefused(next, error); } catch (e) { /* reported, not fatal */ } }
        return step(sent);
      });
    }
    var api = {
      KEY: KEY,
      size: function () { return read().length; },
      entries: read,
      // The decision keys waiting to be sent — the deck treats their cards as decided.
      keys: function () {
        var keys = {};
        read().forEach(function (e) { if (e.body && e.body.key) keys[e.body.key] = true; });
        return keys;
      },
      // An undo of a swipe that never left: every waiting entry for that key goes.
      drop: function (key) {
        var before = read().length;
        write(read().filter(function (e) { return !(e.body && e.body.key === key); }));
        return before - read().length;
      },
      onChange: function (fn) { listeners.push(fn); },
      post: function (path, body) {
        if (!read().length) return attempt(path, body);
        return api.flush().then(function () { return attempt(path, body); });
      },
      flush: function () {
        if (flushing) return flushing;
        if (!read().length) return Promise.resolve({ sent: 0, waiting: 0 });
        flushing = step(0).then(function (r) { flushing = null; return r; }, function (e) { flushing = null; throw e; });
        return flushing;
      }
    };
    // The moments the Mac may be back.
    if (root.addEventListener && typeof root.document !== 'undefined') {
      root.addEventListener('online', function () { api.flush(); });
      root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) api.flush(); });
      if (typeof root.setInterval === 'function') root.setInterval(function () { if (read().length) api.flush(); }, 30000);
    }
    return api;
  }

  var ReviewOutbox = { KEY: KEY, create: create, isNetworkFailure: isNetworkFailure };
  root.ReviewOutbox = ReviewOutbox;
  if (typeof module !== 'undefined' && module.exports) module.exports = ReviewOutbox;
})(typeof window !== 'undefined' ? window : globalThis);

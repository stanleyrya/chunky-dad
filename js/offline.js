// chunky.dad offline support — the half of sw.js that lives on the page.
//
// Registers the service worker (one per site, scope "/"), and shows one
// quiet line at the bottom of the page when the page is working from saved
// copies: the browser says it has no connection, or the worker answered a
// request from its cache because the network was gone or too slow. The line
// goes away on its own when the connection is back. Nothing else changes.
//
// Loaded by every page with <script src="/js/offline.js" defer> — the
// absolute path matters: city pages sit at /<city>/ under a <base>. No
// dependencies, no modules, so the oldest phone Safari runs it.
(function () {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return;

  var ID = 'chunky-offline-note';
  var hideTimer = null;
  var noteRank = 0; // a note about the page itself outranks one about its data

  function when(iso) {
    if (!iso) return '';
    var t = new Date(iso);
    if (isNaN(t.getTime())) return '';
    var ageMinutes = Math.round((Date.now() - t.getTime()) / 60000);
    if (ageMinutes < 2) return ' from a moment ago';
    if (ageMinutes < 60) return ' from ' + ageMinutes + ' min ago';
    if (ageMinutes < 36 * 60) return ' from ' + Math.round(ageMinutes / 60) + ' h ago';
    return ' from ' + t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function note(text, rank) {
    rank = rank || 1;
    if (rank < noteRank) return;
    noteRank = rank;
    var el = document.getElementById(ID);
    if (!el) {
      el = document.createElement('div');
      el.id = ID;
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(12px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);z-index:2147483000;max-width:calc(100vw - 32px);box-sizing:border-box;padding:8px 14px;border-radius:999px;background:rgba(20,20,24,.92);color:#fff;font:600 13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;box-shadow:0 4px 18px rgba(0,0,0,.25);cursor:pointer;';
      el.onclick = function () { hide(); };
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = text;
    el.style.display = '';
    if (hideTimer) clearTimeout(hideTimer);
  }

  function hide() {
    noteRank = 0;
    var el = document.getElementById(ID);
    if (el) el.style.display = 'none';
  }

  function offlineNote() { note('No connection — showing what loaded last time'); }

  window.addEventListener('offline', offlineNote);
  window.addEventListener('online', function () { hide(); });
  if (navigator.onLine === false) {
    if (document.body) offlineNote(); else document.addEventListener('DOMContentLoaded', offlineNote);
  }

  // sw.js posts this when it answered from its cache. "page" is this very
  // page; "data" is a calendar or a data file the page asked for.
  navigator.serviceWorker.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.type !== 'served-from-cache') return;
    var what = data.what === 'page' ? 'This page is a saved copy' : data.what === 'data' ? 'Showing saved data' : 'Working from saved files';
    var rank = data.what === 'page' ? 3 : data.what === 'data' ? 2 : 1;
    var show = function () { note(what + when(data.cachedAt) + ' — no connection right now', rank); };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  });

  // What this page loaded, for the worker to save when it could not watch
  // the load itself: the first visit (no worker yet) and a worker update
  // (the old saved copies were dropped).
  function loadedFiles() {
    var names = [];
    try {
      var entries = performance.getEntriesByType('resource');
      for (var i = 0; i < entries.length; i++) if (entries[i].name && names.indexOf(entries[i].name) === -1) names.push(entries[i].name);
    } catch (_) {}
    return names;
  }
  function askToSave(registration) {
    var worker = navigator.serviceWorker.controller || (registration && registration.active);
    if (!worker) return;
    try { worker.postMessage({ type: 'save-page', url: window.location.href, resources: loadedFiles() }); } catch (_) {}
  }

  var hadWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (hadWorker) navigator.serviceWorker.ready.then(askToSave, function () {});
    hadWorker = true;
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (registration) {
      if (hadWorker) return;
      navigator.serviceWorker.ready.then(function (ready) { askToSave(ready || registration); }, function () {});
    }).catch(function () { /* no worker here (a local server without one) — the page is unchanged */ });
  });
})();

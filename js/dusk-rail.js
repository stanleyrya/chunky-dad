// dusk-rail.js — the mobile DENSE view (dusk pages only).
//
// Mobile week view is a trifold: week grid / 246px card rail with corner
// flyer thumbs (tap -> lightbox) + bottom sheet / map. Swiping the rail
// drives the site's real selection live. When a big week outgrows the
// screen the page grows downward (the map keeps a floor height and the
// page scrolls) rather than layers overlapping.
// Month view: the grid alone; tapping an event pill opens the bottom
// sheet for it in place — no navigation.
// (COZY — a vertical-list alternate mode — was built, field-tested, and
// removed 2026-08-25; mobile has exactly one mode now.)
//
// Contract with the rest of the site (no MutationObservers, no retry timers):
//   'chunky:events-rendered'   the loader finished swapping grid+list DOM
//   'chunky:selection-changed' the loader painted a selection change
//   'dusk:controls-mounted'    dusk-ui (re)assembled the header controls row
//
// Owner laws baked in:
//   - the map CAMERA never moves programmatically (marker highlight only)
//   - nothing here keys off .selected — a mid-flight re-render's stale
//     .selected must not be able to move anything
//   - no programmatic rail scrolling during a user gesture or within 600ms
//     after it; programmatic centering only on init, a trusted tap's grant,
//     or restoring the landed card after a re-render
(function () {
  'use strict';
  const html = document.documentElement;
  if (!html.classList.contains('dusk')) return;

  const params = new URLSearchParams(location.search);
  const mmMobile = window.matchMedia('(max-width: 768.9px)');
  const isMobile = () => mmMobile.matches;
  const loader = () => window.calendarLoader;
  const list = () => document.querySelector('.events-list');
  const resizeMap = () => { try { window.eventsMap && window.eventsMap.resize(); } catch (e) {} };
  const cssEscape = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');

  // ---------- field debug (?swipelog=1): on-screen stamps ----------
  const swipelog = params.get('swipelog') === '1';
  const dbg = [];
  let dbgBox = null;
  const dbgNote = (line) => {
    if (!swipelog) return;
    dbg.push(new Date().toISOString().slice(11, 23) + ' ' + line);
    if (dbg.length > 6) dbg.shift();
    if (!dbgBox) {
      dbgBox = document.createElement('div');
      dbgBox.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:10030;background:rgba(0,0,0,.82);color:#8f8;font:9px/1.4 monospace;padding:6px 8px;border-radius:8px;max-width:88vw;pointer-events:none;white-space:pre;';
      document.body.appendChild(dbgBox);
    }
    dbgBox.textContent = dbg.join('\n');
  };

  // the single mobile mode — the class is the CSS anchor for every dense rule
  html.classList.remove('mode-cozy');
  html.classList.add('mode-dense');

  // ---------- flyer lightbox (corner-thumb + sheet-image tap target) ----------
  let lightbox = null;
  const openLightbox = (url) => {
    if (!url) return;
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'rail-lightbox';
      lightbox.addEventListener('click', () => lightbox.classList.remove('open'));
      document.body.appendChild(lightbox);
    }
    lightbox.innerHTML = '<img alt="">';
    lightbox.querySelector('img').src = url;
    lightbox.classList.add('open');
  };
  const flyerUrlOf = (card) => {
    if (!card) return null;
    const img = card.querySelector('.event-flyer img');
    if (img && (img.currentSrc || img.src)) return img.currentSrc || img.src;
    const flyer = card.querySelector('.event-flyer[data-flyer-url]');
    return flyer ? flyer.getAttribute('data-flyer-url') : null;
  };
  // the loader emits .rail-thumb empty; give it its art only on mobile so the
  // desktop's display:none thumb never triggers an image fetch
  const armThumbs = () => {
    if (!isMobile()) return;
    loadThumbManifest();
    // the timeline rail carries the whole strip (30+ cards) — arming every
    // thumb at once would fetch every flyer up front, so only cards within a
    // few screens of the current position get their art; settles re-arm as
    // the user travels
    const el = list();
    const btns = document.querySelectorAll('.events-list .event-card .rail-thumb');
    // a small rail (Denver: a handful of cards; thumbs are ~10KB companions)
    // arms EVERYTHING up front — the proximity window exists for dense
    // cities whose timeline holds dozens of full-flyer fallbacks, and it
    // always excluded the edge ghosts parked at the strip's far ends (owner:
    // "they don't have the image in the top right corner until a second
    // round of loading")
    const nearOnly = el && el.classList.contains('rail-active') && btns.length > 60;
    const min = nearOnly ? el.scrollLeft - el.clientWidth * 3 : -Infinity;
    const max = nearOnly ? el.scrollLeft + el.clientWidth * 4 : Infinity;
    btns.forEach((btn) => {
      if (btn.style.backgroundImage) return;
      const card = btn.closest('.event-card');
      if (nearOnly) {
        const anchor = card.closest('.rail-edge') || card;
        const c = anchor.offsetLeft + anchor.offsetWidth / 2;
        if (c < min || c > max) return;
      }
      const flyer = card && card.querySelector('.event-flyer[data-flyer-url]');
      const url = flyer && flyer.getAttribute('data-flyer-url');
      if (url) armThumb(btn, url);
    });
  };
  // thumbs.json (written by the CI image sweep) maps a flyer's SOURCE URL —
  // cached JSON events keep their remote image URLs — to its local companion
  // thumb. The browser can't derive that path itself: the local filename
  // embeds a date whose timezone rendering differs between the downloader's
  // runner and the visitor's device (verified off by one day on real events).
  let thumbManifest = null;
  let thumbManifestStarted = false;
  const loadThumbManifest = () => {
    if (thumbManifestStarted || typeof fetch !== 'function') return;
    thumbManifestStarted = true;
    fetch('/img/events/thumbs.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { thumbManifest = json || {}; armThumbs(); })
      .catch(() => { thumbManifest = {}; });
  };
  const assetKeyOf = (url) => {
    try {
      if (window.EventSchema && typeof window.EventSchema.imageAssetKey === 'function') {
        return window.EventSchema.imageAssetKey(url);
      }
    } catch (e) { /* fall through */ }
    // inline twin of EventSchema.imageAssetKey for a page missing the schema
    const raw = String(url || '').trim().split('#')[0].split('?')[0];
    const authority = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.exec(raw);
    if (!authority) return raw;
    const rest = raw.slice(authority[0].length);
    const slash = rest.indexOf('/');
    const host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
    return host + (slash < 0 ? '' : rest.slice(slash));
  };
  const manifestThumbFor = (url) => {
    if (!thumbManifest) return null;
    const entry = thumbManifest[assetKeyOf(url)];
    return entry ? '/img/events/' + entry : null;
  };
  // The corner thumb prefers the CI-generated -thumb.webp companion (a few
  // KB, sized for the 56px box at 3x) over the full flyer (often megabytes):
  // a 30-card timeline was downloading the full library to paint postage
  // stamps. Only LOCAL img/events paths have companions; remote URLs — and
  // any local image whose companion is missing (older CI runs) — load the
  // full file exactly as before. Background images have no onerror, so the
  // probe is an Image preload; the full asset still loads on tap (lightbox).
  const thumbUrlFor = (url) => {
    // any spelling of the local library path (relative, ../-prefixed,
    // absolute, or full chunky.dad URL); remote hosts never contain it
    const m = /^(.*img\/events\/.+)\.(?:jpe?g|png|webp|gif)$/i.exec(url);
    if (!m || url.endsWith('-thumb.webp')) return null;
    return m[1] + '-thumb.webp';
  };
  const armThumb = (btn, url) => {
    const paint = (u) => { btn.style.backgroundImage = 'url("' + u.replace(/"/g, '%22') + '")'; };
    // thumbUrlFor handles URLs already pointing into img/events/; the
    // manifest handles remote source URLs whose local copy is unguessable.
    const small = thumbUrlFor(url) || manifestThumbFor(url);
    if (!small) { paint(url); return; }
    const probe = new Image();
    probe.onload = () => paint(small);
    probe.onerror = () => paint(url);
    probe.src = small;
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.rail-thumb');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation(); // a thumb tap must not toggle the card's selection
    openLightbox(flyerUrlOf(btn.closest('.event-card')));
  }, true);

  // ---------- the bottom sheet: image + title + rows + links + description ----
  // dense uses it for clamped descriptions ('…more' chip); month view (both
  // modes) opens it in place of navigating to the event's week.
  let sheet = null;
  let sheetMap = null;
  const destroySheetMap = () => {
    if (!sheetMap) return;
    try { sheetMap.remove(); } catch (e) {}
    sheetMap = null;
  };
  const closeSheet = () => {
    if (!sheet) return;
    sheet.classList.remove('up');
    setTimeout(() => {
      sheet.classList.remove('open');
      destroySheetMap(); // after the slide-down so the map doesn't vanish mid-flight
    }, 320);
  };
  const openSheet = (card) => {
    if (!card) return;
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'rail-sheet';
      sheet.innerHTML = '<div class="sheet-panel"></div>';
      sheet.addEventListener('click', (e) => {
        if (!(e.target.closest && e.target.closest('.sheet-panel'))) closeSheet();
      });
      document.body.appendChild(sheet);
      // pull-down-to-dismiss: the panel scrolls normally, but when it sits
      // at its very TOP a downward drag grabs the whole sheet instead —
      // it rides the finger, then dismisses past ~110px or a quick flick,
      // else springs back. Drags starting on the map stay the map's.
      const panel0 = sheet.querySelector('.sheet-panel');
      let dragY0 = -1, dragging = false, lastY = 0, lastT = 0, dragV = 0;
      panel0.addEventListener('touchstart', (e) => {
        if (e.target.closest && e.target.closest('.sheet-map')) { dragY0 = -1; return; }
        dragY0 = e.touches[0].clientY;
        lastY = dragY0;
        lastT = performance.now();
        dragging = false;
        dragV = 0;
      }, { passive: true });
      panel0.addEventListener('touchmove', (e) => {
        if (dragY0 < 0) return;
        const y = e.touches[0].clientY;
        const dy = y - dragY0;
        const now = performance.now();
        dragV = (y - lastY) / Math.max(1, now - lastT);
        lastY = y;
        lastT = now;
        if (!dragging) {
          if (panel0.scrollTop <= 0 && dy > 6) dragging = true;
          else if (panel0.scrollTop > 0 || dy < 0) { dragY0 = -1; return; } // the scroll owns this gesture
        }
        if (dragging) {
          e.preventDefault(); // no scroll/rubber-band while the sheet rides the finger
          panel0.style.transition = 'none';
          panel0.style.transform = 'translateY(' + Math.max(0, dy) + 'px)';
        }
      }, { passive: false });
      const endDrag = () => {
        if (!dragging) { dragY0 = -1; return; }
        dragging = false;
        const dy = Math.max(0, lastY - dragY0);
        dragY0 = -1;
        // hand the transform back to the stylesheet in one style recalc:
        // the 300ms transition picks up from the dragged position, so both
        // the dismiss (on to translateY(100%)) and the spring-back (to 0)
        // continue smoothly from under the finger
        panel0.style.transition = '';
        panel0.style.transform = '';
        // deep pull OR a real flick (velocity alone can't dismiss a jiggle)
        if (dy > 110 || (dy > 30 && dragV > 0.55)) closeSheet();
      };
      panel0.addEventListener('touchend', endDrag, { passive: true });
      panel0.addEventListener('touchcancel', endDrag, { passive: true });
    }
    const panel = sheet.querySelector('.sheet-panel');
    panel.innerHTML = '';
    const flyerUrl = flyerUrlOf(card);
    if (flyerUrl) {
      const fig = document.createElement('div');
      fig.className = 'sheet-flyer';
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = flyerUrl;
      img.addEventListener('click', () => openLightbox(flyerUrl));
      fig.appendChild(img);
      panel.appendChild(fig);
    }
    const h = document.createElement('h3');
    h.className = 'sheet-title';
    h.textContent = ((card.querySelector('.ec-title') || {}).textContent || '').trim();
    panel.appendChild(h);
    const rows = card.querySelector('.ec-rows');
    if (rows) {
      const r = rows.cloneNode(true);
      r.classList.add('sheet-rows');
      panel.appendChild(r);
    }
    const links = card.querySelector('.event-links');
    if (links) {
      const l = links.cloneNode(true);
      l.classList.add('sheet-links');
      // the share button's listener doesn't clone — drop it rather than
      // shipping a dead control; the plain anchors work as-is
      l.querySelectorAll('.share-event-btn').forEach((b) => b.remove());
      if (l.children.length) panel.appendChild(l);
    }
    const tea = card.querySelector('.ec-tea');
    if (tea) {
      const d = document.createElement('p');
      d.className = 'sheet-desc';
      d.textContent = tea.textContent.trim();
      panel.appendChild(d);
    }
    // the map, at the BOTTOM of the sheet: the loader builds a read-only
    // twin of the main page's map (same style/theme/favicon icons/city
    // framing, this event's icon selected, the rest dimmed, none clickable).
    // An event with NO location (Bear Happy Hour) gets no map at all — a
    // city map with every icon dimmed and none highlighted reads as broken.
    destroySheetMap();
    const lat = parseFloat(card.getAttribute('data-lat'));
    const lng = parseFloat(card.getAttribute('data-lng'));
    const hasLocation = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
    const l = loader();
    if (hasLocation && l && l.createSheetMap) {
      const mapDiv = document.createElement('div');
      mapDiv.className = 'sheet-map';
      panel.appendChild(mapDiv);
      const slug = card.getAttribute('data-event-slug');
      requestAnimationFrame(() => {
        if (!sheet.classList.contains('open') || !mapDiv.isConnected) return;
        sheetMap = l.createSheetMap(mapDiv, slug);
        if (!sheetMap) mapDiv.remove();
        else sheetMap.once('load', () => { if (sheetMap) sheetMap.resize(); });
      });
    }
    // carry the card's aurora custom props so the sheet paints as the card
    const inline = card.getAttribute('style');
    if (inline) panel.setAttribute('style', inline); else panel.removeAttribute('style');
    sheet.classList.add('open');
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('up')));
  };
  const teaOverflows = (el) => !!el && el.scrollHeight > el.clientHeight + 1;
  const markOverflows = () => {
    if (!isMobile()) return;
    document.querySelectorAll('.events-list .event-card').forEach((card) => {
      const tea = card.querySelector('.ec-tea');
      if (!tea) return;
      let chip = card.querySelector('.ec-more');
      const over = teaOverflows(tea);
      if (over && !chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ec-more';
        chip.textContent = '\u2026more';
        chip.setAttribute('aria-label', 'Show full description');
        tea.insertAdjacentElement('afterend', chip);
      }
      if (chip) chip.style.display = over ? '' : 'none';
    });
  };
  document.addEventListener('click', (e) => {
    if (!isMobile()) return;
    const chip = e.target.closest && e.target.closest('.ec-more');
    const teaHit = !chip && e.target.closest && e.target.closest('.ec-tea');
    if (!chip && !teaHit) return;
    const card = (chip || teaHit).closest('.event-card');
    if (!card) return;
    if (chip || teaOverflows(card.querySelector('.ec-tea'))) {
      e.preventDefault();
      e.stopPropagation();
      openSheet(card);
    }
  }, true);

  // ---------- mobile month view: the grid alone; a pill opens the sheet ----
  const updateMonthFull = () => {
    const isMonth = !!document.querySelector('.calendar-day.month-day');
    html.classList.toggle('month-full', isMonth && isMobile());
  };
  document.addEventListener('click', (e) => {
    if (!html.classList.contains('month-full') || !e.isTrusted) return;
    const pill = e.target.closest && e.target.closest('.calendar-grid .event-item');
    const day = !pill && e.target.closest && e.target.closest('.calendar-day.month-day');
    if (!pill && !day) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const l = loader();
    if (pill) {
      // the sheet, in place — no navigation, no reload feel
      const slug = pill.getAttribute('data-event-slug');
      const card = slug && document.querySelector('.events-list .event-card[data-event-slug="' + cssEscape(slug) + '"]');
      if (card) { openSheet(card); return; }
      // the continuous month strip renders NEIGHBOR months too — their
      // events aren't in the visible list, so build a detached card from
      // the loader's own renderer and open the sheet off that
      if (l && l.getRenderedEventBySlug && l.generateEventCard) {
        const dayEl0 = pill.closest('[data-date]');
        const evData = l.getRenderedEventBySlug(slug, dayEl0 && dayEl0.getAttribute('data-date'));
        if (evData) {
          try {
            const tmp = document.createElement('div');
            tmp.innerHTML = l.generateEventCard(evData);
            const ghost = tmp.querySelector('.event-card');
            if (ghost) { openSheet(ghost); return; }
          } catch (e2) {}
        }
      }
      // last resort: open the event's week rather than doing nothing
      const dayEl = pill.closest('[data-date]');
      const date = dayEl && dayEl.getAttribute('data-date');
      if (l && l.openWeekAt && slug && date) l.openWeekAt(slug, date);
      return;
    }
    const date = day.getAttribute('data-date');
    if (l && l.switchToWeekView && date) l.switchToWeekView(date);
  }, true);

  // ================= the DENSE rail =================
  // fixed 246px cards, snap-x — no geometry ever animates. The swipe drives
  // the site's real selection live (pill spotlight, marker highlight), with
  // ONE deferred URL write per gesture.
  const USER_QUIET = 600;
  let touchActive = false, lastUserTouch = -1e9, interacted = false, gestureScrolled = false;
  let railOwner = 'init', landedSlug = null, landedOcc = null, grantSlug = null, grantOcc = null;
  let phase = 'idle'; // idle | scrub
  let programmatic = false;
  let geom = [], step = 0, railWidth = 0;
  let urlDirty = false;
  let frameRaf = 0, holdTimer = 0, holdSlug = null, holdOcc = null;
  let settleRaf = 0, stillFrames = 0, lastLeft = -1;
  let slotResting = false;     // the rail is/was resting on the empty-week card
  let slotStickyArmed = false; // the slot's neighbours carry sticky pins

  const userBusy = () => touchActive || (performance.now() - lastUserTouch) < USER_QUIET;
  // TOP-LEVEL cards only: the edge slots contain ghost .event-cards, and an
  // unscoped query counted them — first load then centred the Earlier ghost
  // instead of the week's first real card
  const cards = () => { const el = list(); return el ? Array.from(el.querySelectorAll(':scope > .event-card')) : []; };
  // every snap target in the rail, in DOM order: the edge slots and the empty
  // week's card are members of the band, not decorations beside it
  const SLOT_SEL = ':scope > .event-card, :scope > .rail-edge, :scope > .loading-message.empty-slot';
  const slots = () => { const el = list(); return el ? Array.from(el.querySelectorAll(SLOT_SEL)) : []; };
  const cardBySlug = (slug, occISO) => {
    const el = list();
    if (!slug || !el) return null;
    // the timeline holds one card per OCCURRENCE — land on the right one
    if (occISO) {
      const exact = el.querySelector(':scope > .event-card[data-event-slug="' + cssEscape(slug) + '"][data-occurrence="' + cssEscape(occISO) + '"]');
      if (exact) return exact;
    }
    return el.querySelector(':scope > .event-card[data-event-slug="' + cssEscape(slug) + '"]');
  };
  const nearestTo = (pool) => {
    const el = list();
    if (!el) return null;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = null, bestD = Infinity;
    pool.forEach((c) => {
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best;
  };
  const centeredCard = () => nearestTo(cards());
  const centeredSlot = () => nearestTo(slots());
  const railActive = () => { const el = list(); return !!el && el.classList.contains('rail-active'); };

  const buildGeom = () => {
    geom = [];
    const el = list();
    if (!el || !el.classList.contains('rail-active')) return;
    railWidth = el.clientWidth;
    // EVERY slot, not just the cards: an edge slug is '' so scrubbing across
    // one selects nothing (realSelect's slug guard), instead of the rail
    // quietly re-selecting the event card next door
    // each slot's date rides along: cards stamp their own occurrence
    // (data-occurrence, one card per occurrence), edge slots their data-date
    const dateOfSlot = (slot) => {
      const iso = slot.getAttribute('data-occurrence') || slot.getAttribute('data-date');
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        const p = iso.split('-');
        return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
      }
      return null;
    };
    geom = slots().map((slot) => ({
      el: slot,
      slug: slot.getAttribute('data-event-slug') || '',
      occ: slot.getAttribute('data-occurrence') || '',
      center: slot.offsetLeft + slot.offsetWidth / 2,
      date: dateOfSlot(slot)
    }));
    step = geom.length > 1
      ? Math.max(1, geom[1].center - geom[0].center)
      : Math.max(1, (geom[0] && geom[0].el.offsetWidth) || railWidth);
  };
  const geomStale = () => geom.length > 0 && !geom[0].el.isConnected;
  const nearestGeom = (sl) => {
    const mid = sl + railWidth / 2;
    let best = null, bestD = Infinity;
    for (let i = 0; i < geom.length; i++) {
      const d = Math.abs(geom[i].center - mid);
      if (d < bestD) { bestD = d; best = geom[i]; }
    }
    return best;
  };

  // ---------- live selection during the scrub ----------
  const realSelect = (slug, occISO) => {
    const l = loader();
    if (!l || !slug) return;
    if (l.selectedEventSlug === slug && (!occISO || l.selectedEventDateISO === occISO)) return;
    // the card knows its own occurrence now (data-occurrence) — the old pill
    // scan survives only as the fallback for a card without one
    let dateISO = occISO || null;
    if (!dateISO) {
      const pills = document.querySelectorAll('.calendar-grid .event-item[data-event-slug="' + cssEscape(slug) + '"]');
      let bounds = null;
      try { bounds = l.getCurrentPeriodBounds && l.getCurrentPeriodBounds(); } catch (e) {}
      for (let i = 0; i < pills.length; i++) {
        const dayEl = pills[i].closest('[data-date]');
        const d = dayEl && dayEl.getAttribute('data-date');
        if (!d) continue;
        if (!dateISO) dateISO = d; // fallback: first found
        if (bounds) {
          const dt = new Date(d + 'T12:00:00');
          if (dt >= bounds.start && dt <= bounds.end) { dateISO = d; break; }
        }
      }
    }
    try { l.toggleEventSelection(slug, dateISO, { deferUrl: true }); } catch (e) {}
    urlDirty = true;
    landedSlug = slug;
    landedOcc = occISO || landedOcc;
  };
  const flushUrl = () => {
    const l = loader();
    if (l && urlDirty) {
      urlDirty = false;
      try { l.syncUrl(true); } catch (e) {}
    }
  };

  // ---------- edge slots: swipe off the end, keep going ----------
  // The rail's first and last slots aren't events — they name the nearest
  // event OUTSIDE this week and open it when a swipe lands on them. The
  // loader's findAdjacentEvent searches by EVENT, so quiet stretches are
  // stepped over: a swipe can never deposit you on an empty week. (You can
  // still walk into one with the week arrows — that's what the "no events"
  // card is for, and the edge slots sit either side of it so you can leave.)
  let navigating = false;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  // The slot IS the event's real card (owner request 2026-08-30): the same
  // generateEventCard output every in-window event gets, wearing a small
  // Earlier/Later ribbon, with a text fallback if the card cannot be built.
  // The ghost card is display-only — its data-event-slug is STRIPPED so the
  // scrub geometry sees an empty slug and never live-selects an event that
  // is not in the window (the reason edge slots carried no slug to begin
  // with), and pointer-events are off so its links cannot half-work; the
  // slot's own click (goEdge) is the one interaction.
  const edgeHtml = (dir, target, l) => {
    const d = target.date instanceof Date ? target.date : new Date(target.date);
    const when = isNaN(d.getTime()) ? '' : WD[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
    const label = dir === 'prev' ? 'Earlier' : 'Later';

    let cardHtml = '';
    if (target.event && l && l.generateEventCard) {
      try {
        const tmp = document.createElement('div');
        tmp.innerHTML = l.generateEventCard(target.event);
        const ghost = tmp.querySelector('.event-card');
        if (ghost) {
          ghost.removeAttribute('data-event-slug');
          ghost.classList.add('rail-edge-ghost');
          // The ghost keeps its thumb, links and share button so it is
          // PIXEL-IDENTICAL to the real card that replaces it on arrival —
          // stripping them made the handoff visibly jarring (owner report:
          // "missing the image, missing the more..."). They are inert via
          // pointer-events (the slot's tap is the one interaction), and the
          // wrapper is a div[role=button] precisely so nested buttons parse:
          // a real <button> wrapper was force-closed at the first one.
          cardHtml = ghost.outerHTML;
        }
      } catch (e) { cardHtml = ''; }
    }
    const inner = cardHtml
      || '<span class="edge-arrow" aria-hidden="true"></span>' +
         '<span class="edge-label">' + esc(label) + '</span>' +
         '<span class="edge-when">' + esc(when) + '</span>' +
         '<span class="edge-name">' + esc(target.name) + '</span>';
    // a DIV with button semantics, not a <button>, so it can legally hold the
    // ghost card (activated by click; goEdge's listener handles it)
    return '<div role="button" tabindex="0" class="rail-edge rail-edge-' + dir + (cardHtml ? ' has-card' : '') + '"' +
      ' data-slug="' + esc(target.slug) + '" data-date="' + esc(target.dateISO) + '"' +
      ' aria-label="' + esc(label + ' week: ' + target.name + ', ' + when) + '">' +
      inner +
      '</div>';
  };

  const buildEdgeSlots = () => {
    const el = list();
    if (!el) return;
    el.querySelectorAll('.rail-edge').forEach((n) => n.remove());
    if (!isMobile() || !el.classList.contains('rail-active')) return;
    const l = loader();
    if (!l || l.currentView !== 'week' || typeof l.findAdjacentEvent !== 'function') return;
    // still loading (the plain '📅 Getting events…' message): no edges until
    // the week's real contents are on screen
    if (!el.querySelector('.event-card, .loading-message.empty-slot')) return;
    [['prev', 'afterbegin'], ['next', 'beforeend']].forEach((pair) => {
      let target = null;
      // past the STRIP, not the window: the timeline rail already carries
      // every on-strip event as a real card
      try { target = l.findAdjacentEvent(pair[0], 190, 'strip'); } catch (e) { target = null; }
      if (!target || !target.slug || !target.dateISO) return;
      el.insertAdjacentHTML(pair[1], edgeHtml(pair[0], target, l));
    });
    // the ghosts arrive after the render pass already armed the real cards —
    // give them their corner art and '...more' chips too, or they visibly
    // differ from the card that replaces them on arrival
    armThumbs();
    markOverflows();
  };
  const goEdge = (edge) => {
    const l = loader();
    if (!edge || navigating || !l || typeof l.openWeekAt !== 'function') return;
    const slug = edge.getAttribute('data-slug');
    const date = edge.getAttribute('data-date');
    if (!slug || !date) return;
    navigating = true;
    phase = 'idle';
    urlDirty = false;          // openWeekAt writes the URL itself
    landedSlug = slug;
    grantSlug = slug;          // the swipe IS the grant: centre the arrival
    const dir = edge.classList.contains('rail-edge-prev') ? 'prev' : 'next';
    dbgNote('edge(' + dir + ') -> ' + slug.slice(0, 16) + ' @' + date);
    // revealAdjacent shifts the continuous window JUST enough to include the
    // target (Earlier -> first day, Later -> last day) and refreshes lightly,
    // so the swipe reads as a continuation; openWeekAt is the fallback
    const go = typeof l.revealAdjacent === 'function'
      ? () => l.revealAdjacent(slug, date, dir)
      : () => l.openWeekAt(slug, date);
    Promise.resolve()
      .then(go)
      .catch(() => {})
      .then(() => { navigating = false; });
  };
  document.addEventListener('click', (e) => {
    const edge = e.target.closest && e.target.closest('.rail-edge');
    if (!edge) return;
    e.preventDefault();
    e.stopPropagation();
    goEdge(edge);
  }, true);
  // the slot is a div[role=button] (a real <button> cannot contain the ghost
  // card's markup), so Enter/Space activation is wired by hand
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const edge = e.target.closest && e.target.closest('.rail-edge');
    if (!edge) return;
    e.preventDefault();
    goEdge(edge);
  }, true);

  const settle = (fromUser) => {
    clearTimeout(holdTimer);
    phase = 'idle';
    if (fromUser) {
      mergeSlotNow(); // landing beside the empty week merges it on the spot
      const slot = centeredSlot();
      if (slot && slot.classList.contains('rail-edge')) { goEdge(slot); return; }
      // resting on the empty-week slot is a real resting place — it must not
      // select (or navigate to) whichever card happens to be nearest
      if (slot && slot.classList.contains('empty-slot')) { slotResting = true; armSlotSticky(); armThumbs(); flushUrl(); return; }
      const c = centeredCard();
      if (c) {
        railOwner = 'user';
        landedSlug = c.getAttribute('data-event-slug') || landedSlug;
        landedOcc = c.getAttribute('data-occurrence') || null;
        dbgNote('landed ' + (landedSlug || '?').slice(0, 16) + (landedOcc ? ' @' + landedOcc : ''));
        realSelect(landedSlug, landedOcc);
        // The calendar moves ONLY when it has to (owner report: it moved on
        // every swipe): if the landed occurrence is outside the visible
        // window, revealAdjacent shifts the dates just enough — Earlier
        // lands as the window's first day, Later as its last. Inside the
        // window, the grid does not move at all.
        const l = loader();
        const entry = geom.find((g) => g.el === c);
        if (l && entry && entry.date != null && typeof l.revealAdjacent === 'function' && landedOcc) {
          let bounds = null;
          try { bounds = l.getCurrentPeriodBounds(); } catch (e) {}
          if (bounds && (entry.date < bounds.start.getTime() || entry.date > bounds.end.getTime())) {
            const dir = entry.date < bounds.start.getTime() ? 'prev' : 'next';
            urlDirty = false; // revealAdjacent syncs the URL itself
            Promise.resolve().then(() => l.revealAdjacent(landedSlug, landedOcc, dir)).catch(() => {});
          }
        }
      }
    }
    // re-arm around wherever the rail now rests — including programmatic
    // settles (the initial centring): arming only on user gestures left the
    // cards around the landing spot artless until the first swipe
    armThumbs();
    flushUrl();
  };
  const armSettleWatch = () => {
    if (settleRaf) return;
    stillFrames = 0; lastLeft = -1;
    const tick = () => {
      const el = list();
      if (!el || !railActive()) { settleRaf = 0; return; }
      if (touchActive) { stillFrames = 0; lastLeft = el.scrollLeft; settleRaf = setTimeout(tick, 16); return; }
      if (el.scrollLeft === lastLeft) stillFrames++; else { stillFrames = 0; lastLeft = el.scrollLeft; }
      if (stillFrames >= 6) { settleRaf = 0; finishGesture(); return; }
      settleRaf = setTimeout(tick, 16);
    };
    settleRaf = setTimeout(tick, 16);
  };
  const finishGesture = () => {
    const wasProg = programmatic;
    programmatic = false;
    if (phase === 'scrub') settle(true);
    else if (wasProg) settle(false);
  };
  document.addEventListener('scrollend', (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('events-list')) return;
    if (touchActive) return; // a resting finger is not a settle
    if (settleRaf) { clearTimeout(settleRaf); settleRaf = 0; }
    finishGesture();
  }, true);

  // The scrub touches NOTHING but the rail: no grid writes per frame (the
  // per-frame follow stuttered on real hardware and moved the calendar for
  // swipes that never left the window — owner report 2026-08-31). The grid
  // moves once, on landing, and only when the landed card is outside the
  // visible window (see settle).
  const onScrubFrame = () => {
    frameRaf = 0;
    if (phase !== 'scrub' || !railActive()) return;
    if (geomStale() || !geom.length) buildGeom();
    armThumbs(); // the proximity window travels with the swipe
    const el = list();
    const g = el && nearestGeom(el.scrollLeft);
    if (g && g.slug && (g.slug !== holdSlug || g.occ !== holdOcc)) {
      holdSlug = g.slug;
      holdOcc = g.occ;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { if (phase === 'scrub') realSelect(g.slug, g.occ); }, 120);
    }
  };
  // Swiping OFF the empty-week card must leave the abandoned neighbour
  // perfectly still — and a scroll-event pin cannot do that: iOS scrolls on
  // the compositor thread, so a JS counter-transform lands a frame late and
  // the card jitters (owner: "SUPER JITTERY"). Same lesson as the multi-day
  // labels (.md-sticky-label): position:sticky, where the COMPOSITOR pins
  // the box with no script in the loop. While the rail rests on the empty
  // card, both neighbours become independently pinned items: the past card
  // sticks at its resting viewport offset via `left` (binding only when the
  // strip moves away from it — swipe toward it and it travels normally),
  // the future card mirrors via `right`. The empty card is static, so the
  // stuck neighbour paints above it: it slides in BEHIND the still card and
  // at a full one-pitch swipe is exactly covered by it — visually gone with
  // no fade and no frame budget. Flow geometry (offsetLeft, snap positions,
  // the rail's own centring math) is untouched by sticky displacement, and
  // the stuck card's visual position at landing IS its post-rebuild peek
  // position, so the rebuild that removes the slot and clears these styles
  // stays a visual no-op. Drifting back to the empty week releases the
  // constraint continuously — the card re-emerges, nothing to undo.
  const armSlotSticky = () => {
    const el = list();
    if (!el) return;
    const slot = el.querySelector(':scope > .loading-message.empty-slot');
    if (!slot) return;
    const listRect = el.getBoundingClientRect();
    // sticky offsets are measured from the scrollport's PADDING box — the
    // rail carries the 2.8rem phantom gutters as padding, so an offset
    // computed from the border box would shift the card a gutter's width
    // the moment it is armed (probed: 45px at 390w)
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const prev = slot.previousElementSibling;
    const next = slot.nextElementSibling;
    if (prev) {
      prev.style.position = 'sticky';
      prev.style.left = (prev.getBoundingClientRect().left - listRect.left - padL) + 'px';
      prev.style.right = 'auto';
      prev.style.zIndex = '1'; // above the slot's z-index:0 — it slides UNDER
    }
    if (next) {
      next.style.position = 'sticky';
      next.style.right = (listRect.right - next.getBoundingClientRect().right - padR) + 'px';
      next.style.left = 'auto';
      next.style.zIndex = '1';
    }
    slotStickyArmed = !!(prev || next);
  };
  // A rebuild made the collapse real (or the strip changed shape): reused
  // cards must not carry the pin into the new strip.
  const clearSlotSticky = () => {
    const el = list();
    if (el && (slotStickyArmed || slotResting)) {
      el.querySelectorAll(':scope > *').forEach((n) => {
        if (n.style.position) { n.style.position = ''; n.style.left = ''; n.style.right = ''; n.style.zIndex = ''; }
      });
    }
    slotResting = false;
    slotStickyArmed = false;
  };
  // The merge must not wait for the landing rebuild (settle -> select ->
  // grid glide -> panel refresh, ~a third of a second): a quick swipe back
  // in that window moved through the PRE-merge strip and then had the
  // rebuild land mid-gesture (owner: "snap to a merge immediately once it
  // hits the spot and any more swiping is normal"). The instant the rail
  // sits on a neighbour's snap spot, the slot is removed from the DOM right
  // here: scrollLeft is compensated in the same frame when the slot was on
  // the left of the target, which puts the pinned card's natural position
  // exactly where sticky was holding it visually — nothing on screen moves,
  // and the strip IS a normal timeline before any further gesture. The
  // later rebuild re-renders the same collapsed set and stays a no-op.
  // Called from scrollend-settle and from the start of a new grab; never
  // during an active pan (DOM churn there drops the gesture).
  const mergeSlotNow = () => {
    if (!slotStickyArmed) return false;
    const el = list();
    if (!el) return false;
    const slot = el.querySelector(':scope > .loading-message.empty-slot');
    if (!slot) { clearSlotSticky(); return false; }
    const mid = el.scrollLeft + el.clientWidth / 2;
    const slotMid = slot.offsetLeft + slot.offsetWidth / 2;
    const target = mid > slotMid ? slot.nextElementSibling : slot.previousElementSibling;
    if (!target) return false;
    if (Math.abs(target.offsetLeft + target.offsetWidth / 2 - mid) > 3) return false;
    slot.remove();
    clearSlotSticky();
    // ABSOLUTE re-centre, not a relative adjustment: the browser's scroll
    // anchoring already moves scrollLeft when content before it is removed
    // (probed: a relative delta double-compensated and snapped to the wrong
    // card), and the absolute write is right no matter what anchoring did
    programmatic = true;
    el.scrollLeft = target.offsetLeft + target.offsetWidth / 2 - el.clientWidth / 2;
    buildGeom();
    dbgNote('slot merged');
    return true;
  };
  document.addEventListener('scroll', (e) => {
    if (!isMobile()) return;
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('events-list') || !t.classList.contains('rail-active')) return;
    if (phase === 'idle' && !programmatic) phase = 'scrub'; // wheel/trackpad gestures have no touchstart
    if (phase === 'scrub') {
      gestureScrolled = true;
      if (!frameRaf) frameRaf = requestAnimationFrame(onScrubFrame);
    }
    armSettleWatch();
  }, { capture: true, passive: true });

  // ---------- gestures + ownership ----------
  const onTouch = (e) => {
    if (!isMobile()) return;
    if (!(e.target.closest && e.target.closest('.events-list'))) return;
    // a re-grab before the landing settle ever fired: if the rail is sitting
    // on a neighbour's spot, merge NOW, before this pan starts moving —
    // the new gesture must ride the normal timeline
    if (slotStickyArmed && !touchActive) mergeSlotNow();
    interacted = true;
    touchActive = true;
    gestureScrolled = false;
    railOwner = 'user';
    grantSlug = null; grantOcc = null; // a new gesture invalidates any pending grant
    lastUserTouch = performance.now();
    if (railActive()) phase = 'scrub';
  };
  const offTouch = () => {
    if (!touchActive) return;
    touchActive = false;
    lastUserTouch = performance.now();
    if (!gestureScrolled && phase === 'scrub') phase = 'idle'; // plain tap, no drag
  };
  document.addEventListener('touchstart', onTouch, { passive: true, capture: true });
  document.addEventListener('pointerdown', onTouch, { passive: true, capture: true });
  ['touchend', 'touchcancel', 'pointerup', 'pointercancel'].forEach((ev) =>
    document.addEventListener(ev, offTouch, { passive: true, capture: true }));
  // a REAL tap (trusted) on a pill or card grants centering for that slug —
  // but not taps on the card's inner controls (thumb/share/links): those
  // never change the selection, and an unconsumed grant would later yank
  // the rail back to this card mid-swipe
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    if (e.target.closest && e.target.closest('.rail-thumb, .share-event-btn, .event-links, .ec-more')) return;
    const pill = e.target.closest && e.target.closest('.calendar-grid .event-item');
    const card = !pill && e.target.closest && e.target.closest('.events-list .event-card');
    const src = pill || card;
    if (!src) return;
    const slug = src.getAttribute('data-event-slug');
    if (!slug) return;
    // WHICH occurrence was tapped: the card carries data-occurrence, a pill's
    // day cell carries data-date. Slug alone sent the centring to the FIRST
    // occurrence in the timeline — a tap on today's card flung the rail four
    // weeks left to the oldest one.
    let occ = src.getAttribute('data-occurrence') || null;
    if (!occ && pill) {
      const dayEl = pill.closest('[data-date]');
      occ = dayEl ? dayEl.getAttribute('data-date') : null;
    }
    landedSlug = slug;
    landedOcc = occ;
    grantSlug = slug;
    grantOcc = occ;
    dbgNote((pill ? 'pill' : 'card') + ' tap -> grant ' + slug.slice(0, 16) + (occ ? ' @' + occ : ''));
  }, true);

  const centerOn = (card, reason, instant) => {
    const el = list();
    if (!el || !card || !isMobile()) return false;
    const slug = card.getAttribute('data-event-slug');
    const granted = !!grantSlug && grantSlug === slug;
    // a grant IS the user's own tap — it bypasses the post-gesture quiet
    // period (which exists to block UNREQUESTED programmatic moves); init
    // centering still defers to an active finger
    if (!granted && railOwner !== 'init') { dbgNote('DENY center (' + reason + ')'); return false; }
    if (!granted && userBusy()) { dbgNote('SKIP center (busy)'); return false; }
    if (granted) { grantSlug = null; grantOcc = null; }
    landedSlug = slug;
    landedOcc = card.getAttribute('data-occurrence') || landedOcc;
    const target = Math.round(card.offsetLeft + card.offsetWidth / 2 - el.clientWidth / 2);
    if (Math.abs(el.scrollLeft - target) < 4) return true;
    programmatic = true;
    dbgNote('center(' + reason + ') @' + target);
    el.scrollTo({ left: target, behavior: (instant || !interacted) ? 'auto' : 'smooth' });
    armSettleWatch();
    return true;
  };

  // ---------- rail structure ----------
  let denseMapH = -1;
  const sizeDenseMap = () => {
    const sec = document.querySelector('.events-map-section');
    if (!sec) return;
    if (!isMobile() || html.classList.contains('month-full')) {
      if (sec.style.height) { sec.style.height = ''; sec.style.flex = ''; resizeMap(); }
      denseMapH = -1;
      return;
    }
    // fill from the section's DOCUMENT position to the viewport bottom —
    // when the week grid outgrows the screen this hits the floor and the
    // PAGE grows downward instead (the map never overlaps the cards).
    // Document coords, not viewport rect alone: the page can be scrolled
    // when this runs, and a viewport-relative top would feed back.
    const secDocTop = sec.getBoundingClientRect().top + window.scrollY;
    const h = Math.max(200, Math.floor(window.innerHeight - secDocTop - 6));
    if (h === denseMapH) return;
    denseMapH = h;
    sec.style.height = h + 'px';
    sec.style.flex = 'none';
    resizeMap();
  };

  const selectedSlug = () => { const l = loader(); return (l && l.selectedEventSlug) || null; };

  // the timeline rail starts weeks in the past — resting position is the
  // first card ON or AFTER the visible window's start, never the strip's
  // oldest card
  const firstWindowCard = () => {
    const l = loader();
    if (!l || !geom.length) return null;
    let startMs = 0, endMs = Infinity;
    try {
      const b = l.getCurrentPeriodBounds();
      startMs = b.start.getTime();
      endMs = b.end.getTime();
    } catch (e) { return null; }
    for (let i = 0; i < geom.length; i++) {
      const g = geom[i];
      // IN the window, not merely on-or-after its start — without the end
      // bound an empty week rested on a card weeks in the future instead of
      // the empty-week slot (owner report: Denver)
      if (g.date != null && g.slug && g.date >= startMs && g.date <= endMs) return g.el;
    }
    return null;
  };
  const centerRestingCard = (instant) => {
    const el = list();
    if (!el) return;
    // an empty week still has a slot to rest on — otherwise the rail opens
    // parked on the "Earlier" edge, which would bounce straight back out
    const l = loader();
    const selEl = cardBySlug(selectedSlug(), l && l.selectedEventDateISO);
    let landedEl = cardBySlug(landedSlug, landedOcc);
    // The loader can navigate WITHOUT the rail — Today, the arrows, a month
    // jump — and it clears the selection when it does. A landed position
    // from the previous journey is then stale: honouring it flung the rail
    // (and, via the out-of-window settle, the whole window) back to wherever
    // the user last was, so Today never actually arrived at today.
    if (landedEl && !selEl && l) {
      try {
        const iso = landedEl.getAttribute('data-occurrence');
        if (iso) {
          const p = iso.split('-');
          const t = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12).getTime();
          const b = l.getCurrentPeriodBounds();
          if (t < b.start.getTime() || t > b.end.getTime()) {
            landedEl = null;
            landedSlug = null;
            landedOcc = null;
          }
        }
      } catch (e) {}
    }
    const target = selEl || landedEl || firstWindowCard()
      || el.querySelector('.loading-message.empty-slot')
      || cards()[0];
    if (!target) return;
    slotResting = !!(target.classList && target.classList.contains('empty-slot'));
    landedSlug = target.getAttribute('data-event-slug') || landedSlug;
    landedOcc = target.getAttribute('data-occurrence') || landedOcc;
    if (grantSlug === landedSlug) { grantSlug = null; grantOcc = null; }
    const t = Math.round(target.offsetLeft + target.offsetWidth / 2 - el.clientWidth / 2);
    if (Math.abs(el.scrollLeft - t) >= 1 && instant) { programmatic = true; el.scrollLeft = t; }
    // AFTER the centring write: the sticky offsets must capture the resting
    // viewport positions, not wherever the strip was a moment ago
    if (slotResting && !slotStickyArmed) armSlotSticky();
  };

  const syncRailState = (reason) => {
    const el = list();
    if (!el) return;
    // the loader renders the rail's TIMELINE card set only while the mobile
    // rail exists; desktop keeps the visible-window list untouched. A
    // breakpoint crossing (iPad rotation) changes the flag, so the list is
    // re-rendered once to match the mode it just entered.
    const l0 = loader();
    if (l0) {
      const want = isMobile();
      if (l0.railTimeline !== want) {
        l0.railTimeline = want;
        if (reason === 'breakpoint' && typeof l0.refreshEventsPanel === 'function') {
          Promise.resolve()
            .then(() => l0.refreshEventsPanel(l0.getFilteredEvents(), false, { keepCamera: true }))
            .catch(() => {});
        }
      }
    }
    if (!isMobile()) {
      if (el.classList.contains('rail-active')) { el.classList.remove('rail-active'); phase = 'idle'; geom = []; }
      updateMonthFull();
      return;
    }
    updateMonthFull();
    sizeDenseMap();
    const want = !html.classList.contains('month-full');
    const has = el.classList.contains('rail-active');
    if (want && !has) {
      el.classList.add('rail-active');
      clearSlotSticky(); // reused cards must not carry a stale pin
      armThumbs();
      buildEdgeSlots();
      buildGeom();
      centerRestingCard(true);
      // the centring just moved the viewport — arm around where it landed
      armThumbs();
      resizeMap();
      dbgNote('rail ON');
    } else if (!want && has) {
      el.classList.remove('rail-active');
      phase = 'idle';
      geom = [];
      resizeMap();
      dbgNote('rail OFF');
    } else if (want && has) {
      if (reason === 'render' || reason === 'resize' || geomStale()) {
        if (reason === 'render') clearSlotSticky();
        armThumbs();
        // NOT on resize: iOS fires one on every URL-bar reveal, and the edge
        // lookup expands recurrences over six months. The slots the render
        // built are still correct — only the geometry moved.
        if (reason !== 'resize' || !el.querySelector('.rail-edge')) buildEdgeSlots();
        buildGeom();
        centerRestingCard(reason === 'render');
        armThumbs();
      } else if (grantSlug) {
        const g = cardBySlug(grantSlug, grantOcc);
        if (g) centerOn(g, reason);
      } else if (reason === 'selection' && phase === 'idle' && !userBusy()) {
        // a selection that arrived from OUTSIDE the rail (a map-marker tap
        // has no card/pill to grant through) — adopt it so the rail follows
        // instead of silently re-selecting the centered card later
        const slug = selectedSlug();
        const l1 = loader();
        const selOcc = l1 ? l1.selectedEventDateISO : null;
        const sel = slug && (slug !== landedSlug || (selOcc && selOcc !== landedOcc))
          && cardBySlug(slug, selOcc);
        if (sel) {
          grantSlug = slug;
          grantOcc = selOcc;
          centerOn(sel, 'external-selection');
        }
      }
    }
  };

  // ---------- the two loader events + environment changes ----------
  document.addEventListener('chunky:selection-changed', () => syncRailState('selection'));
  document.addEventListener('chunky:events-rendered', () => {
    navigating = false;   // the week an edge slot asked for is on screen
    armThumbs();
    markOverflows();
    syncRailState('render');
  });
  window.addEventListener('resize', () => {
    denseMapH = -1;
    markOverflows();
    syncRailState('resize');
  });
  mmMobile.addEventListener('change', () => {
    denseMapH = -1;
    armThumbs();
    markOverflows();
    syncRailState('breakpoint');
  });
  document.addEventListener('DOMContentLoaded', () => {
    armThumbs();
    syncRailState('boot');
  });
  syncRailState('boot');

  // ---------- debug surface ----------
  window.duskRail = {
    openLightbox,
    openSheet,
    buildEdgeSlots,
    goEdge,
    state: () => ({
      phase, railOwner, landedSlug, grantSlug, touchActive,
      programmatic, interacted, navigating, railActive: railActive()
    }),
    geom: () => geom.map((g) => ({ slug: g.slug.slice(0, 14), center: g.center }))
  };
})();

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
    document.querySelectorAll('.events-list .event-card .rail-thumb').forEach((btn) => {
      if (btn.style.backgroundImage) return;
      const card = btn.closest('.event-card');
      const flyer = card && card.querySelector('.event-flyer[data-flyer-url]');
      const url = flyer && flyer.getAttribute('data-flyer-url');
      if (url) btn.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
    });
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
    // framing, this event's icon selected, the rest dimmed, none clickable)
    destroySheetMap();
    const l = loader();
    if (l && l.createSheetMap) {
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
      // the month list should always carry the card; if it somehow doesn't,
      // fall back to opening the event's week rather than doing nothing
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
  let railOwner = 'init', landedSlug = null, grantSlug = null;
  let phase = 'idle'; // idle | scrub
  let programmatic = false;
  let geom = [], step = 0, railWidth = 0;
  let urlDirty = false;
  let frameRaf = 0, holdTimer = 0, holdSlug = null;
  let settleRaf = 0, stillFrames = 0, lastLeft = -1;

  const userBusy = () => touchActive || (performance.now() - lastUserTouch) < USER_QUIET;
  const cards = () => { const el = list(); return el ? Array.from(el.querySelectorAll('.event-card')) : []; };
  const cardBySlug = (slug) => {
    const el = list();
    return (slug && el) ? el.querySelector('.event-card[data-event-slug="' + cssEscape(slug) + '"]') : null;
  };
  const centeredCard = () => {
    const el = list();
    if (!el) return null;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = null, bestD = Infinity;
    cards().forEach((c) => {
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best;
  };
  const railActive = () => { const el = list(); return !!el && el.classList.contains('rail-active'); };

  const buildGeom = () => {
    geom = [];
    const el = list();
    if (!el || !el.classList.contains('rail-active')) return;
    railWidth = el.clientWidth;
    geom = cards().map((card) => ({
      el: card,
      slug: card.getAttribute('data-event-slug') || '',
      center: card.offsetLeft + card.offsetWidth / 2
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
  const realSelect = (slug) => {
    const l = loader();
    if (!l || !slug || l.selectedEventSlug === slug) return;
    const pill = document.querySelector('.calendar-grid .event-item[data-event-slug="' + cssEscape(slug) + '"]');
    const dayEl = pill && pill.closest('[data-date]');
    const dateISO = dayEl ? dayEl.getAttribute('data-date') : null;
    try { l.toggleEventSelection(slug, dateISO, { deferUrl: true }); } catch (e) {}
    urlDirty = true;
    landedSlug = slug;
  };
  const flushUrl = () => {
    const l = loader();
    if (l && urlDirty) {
      urlDirty = false;
      try { l.syncUrl(true); } catch (e) {}
    }
  };

  const settle = (fromUser) => {
    clearTimeout(holdTimer);
    phase = 'idle';
    if (fromUser) {
      const c = centeredCard();
      if (c) {
        railOwner = 'user';
        landedSlug = c.getAttribute('data-event-slug') || landedSlug;
        dbgNote('landed ' + (landedSlug || '?').slice(0, 16));
        realSelect(landedSlug);
      }
    }
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

  const onScrubFrame = () => {
    frameRaf = 0;
    if (phase !== 'scrub' || !railActive()) return;
    if (geomStale() || !geom.length) buildGeom();
    const el = list();
    const g = el && nearestGeom(el.scrollLeft);
    if (g && g.slug && g.slug !== holdSlug) {
      holdSlug = g.slug;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => { if (phase === 'scrub') realSelect(g.slug); }, 120);
    }
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
    interacted = true;
    touchActive = true;
    gestureScrolled = false;
    railOwner = 'user';
    grantSlug = null; // a new gesture invalidates any pending grant
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
    landedSlug = slug;
    grantSlug = slug;
    dbgNote((pill ? 'pill' : 'card') + ' tap -> grant ' + slug.slice(0, 16));
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
    if (granted) grantSlug = null;
    landedSlug = slug;
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

  const centerRestingCard = (instant) => {
    const el = list();
    if (!el) return;
    const target = cardBySlug(landedSlug) || cardBySlug(selectedSlug()) || cards()[0];
    if (!target) return;
    landedSlug = target.getAttribute('data-event-slug') || landedSlug;
    if (grantSlug === landedSlug) grantSlug = null;
    const t = Math.round(target.offsetLeft + target.offsetWidth / 2 - el.clientWidth / 2);
    if (Math.abs(el.scrollLeft - t) >= 1 && instant) { programmatic = true; el.scrollLeft = t; }
  };

  const syncRailState = (reason) => {
    const el = list();
    if (!el) return;
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
      armThumbs();
      buildGeom();
      centerRestingCard(true);
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
        armThumbs();
        buildGeom();
        centerRestingCard(reason === 'render');
      } else if (grantSlug) {
        const g = cardBySlug(grantSlug);
        if (g) centerOn(g, reason);
      } else if (reason === 'selection' && phase === 'idle' && !userBusy()) {
        // a selection that arrived from OUTSIDE the rail (a map-marker tap
        // has no card/pill to grant through) — adopt it so the rail follows
        // instead of silently re-selecting the centered card later
        const slug = selectedSlug();
        const sel = slug && slug !== landedSlug && cardBySlug(slug);
        if (sel) {
          grantSlug = slug;
          centerOn(sel, 'external-selection');
        }
      }
    }
  };

  // ---------- the two loader events + environment changes ----------
  document.addEventListener('chunky:selection-changed', () => syncRailState('selection'));
  document.addEventListener('chunky:events-rendered', () => {
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
    state: () => ({
      phase, railOwner, landedSlug, grantSlug, touchActive,
      programmatic, interacted, railActive: railActive()
    }),
    geom: () => geom.map((g) => ({ slug: g.slug.slice(0, 14), center: g.center }))
  };
})();

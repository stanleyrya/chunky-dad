// dusk-rail.js — the mobile COZY/DENSE view system (dusk pages only).
//
// COZY  = the production vertical list until an event is selected, then a
//         horizontal swipe rail whose card expansion is scroll-linked.
// DENSE = a fixed-screen trifold: week grid / 246px card rail / map.
//
// Contract with the rest of the site (no MutationObservers, no retry timers):
//   'chunky:events-rendered'   the loader finished swapping grid+list DOM
//   'chunky:selection-changed' the loader painted a selection change
//   'dusk:controls-mounted'    dusk-ui (re)assembled the header controls row
//
// Owner laws baked in:
//   - the map CAMERA never moves programmatically (marker highlight only)
//   - geometry NEVER keys off .selected — a mid-flight re-render's stale
//     .selected must not be able to move or resize anything
//   - no programmatic rail scrolling during a user gesture or within 600ms
//     after it; programmatic centering only on init, a trusted tap's grant,
//     or restoring the landed card after a re-render
//   - transitions exist ONLY under .rail-settling; the per-frame writer and
//     CSS transitions are mutually exclusive by state machine, not by luck
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

  // ---------- field debug (?swipelog=1 / ?bandlog=1): on-screen stamps ----------
  const swipelog = params.get('swipelog') === '1';
  const bandlog = params.get('bandlog') === '1';
  const dbg = [];
  let dbgBox = null;
  const pushNote = (line) => {
    dbg.push(new Date().toISOString().slice(11, 23) + ' ' + line);
    if (dbg.length > 6) dbg.shift();
    if (!dbgBox) {
      dbgBox = document.createElement('div');
      dbgBox.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:10030;background:rgba(0,0,0,.82);color:#8f8;font:9px/1.4 monospace;padding:6px 8px;border-radius:8px;max-width:88vw;pointer-events:none;white-space:pre;';
      document.body.appendChild(dbgBox);
    }
    dbgBox.textContent = dbg.join('\n');
  };
  const dbgNote = (line) => { if (swipelog) pushNote(line); };
  const bandNote = (line) => { if (bandlog) pushNote(line); };

  // ---------- mode: cozy (default) | dense ----------
  const MODE_KEY = 'chunky-view-mode';
  let mode = params.get('mode');
  if (mode !== 'cozy' && mode !== 'dense') {
    try { mode = localStorage.getItem(MODE_KEY); } catch (e) { mode = null; }
  }
  if (mode !== 'dense') mode = 'cozy';
  const isDense = () => mode === 'dense';
  const applyModeClass = () => {
    html.classList.remove('mode-cozy', 'mode-dense');
    html.classList.add('mode-' + mode);
  };
  applyModeClass();
  if (params.get('mode') === mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  }

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'mode-toggle';
  modeBtn.setAttribute('aria-label', 'Switch view density');
  const paintModeLabel = () => { modeBtn.textContent = isDense() ? 'DENSE' : 'COZY'; };
  const mountToggle = () => {
    const switcher = document.querySelector('header .city-switcher');
    if (!switcher) return;
    if (modeBtn.parentElement !== switcher.parentElement || modeBtn.nextElementSibling !== switcher) {
      switcher.parentElement.insertBefore(modeBtn, switcher);
    }
    paintModeLabel();
  };
  document.addEventListener('dusk:controls-mounted', mountToggle);
  const setMode = (m) => {
    if ((m !== 'cozy' && m !== 'dense') || m === mode) return;
    mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    try {
      const u = new URL(location.href);
      u.searchParams.set('mode', m);
      history.replaceState(history.state, '', u);
    } catch (e) {}
    applyModeClass();
    paintModeLabel();
    denseMapH = -1;
    if (isDense()) markOverflows();
    syncRailState('mode-switch');
    dbgNote('mode -> ' + m);
  };
  modeBtn.addEventListener('click', (e) => { e.preventDefault(); setMode(isDense() ? 'cozy' : 'dense'); });

  // ---------- flyer lightbox (corner-thumb tap target) ----------
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
    const card = btn.closest('.event-card');
    const img = card && card.querySelector('.event-flyer img');
    const flyer = card && card.querySelector('.event-flyer[data-flyer-url]');
    openLightbox((img && (img.currentSrc || img.src)) || (flyer && flyer.getAttribute('data-flyer-url')));
  }, true);

  // ---------- dense description sheet (+ '…more' chip) ----------
  // cozy shows the full description inline (the rail expansion IS the sheet);
  // only dense clamps text and offers the bottom sheet.
  let sheet = null;
  const closeSheet = () => {
    if (!sheet) return;
    sheet.classList.remove('up');
    setTimeout(() => sheet.classList.remove('open'), 320);
  };
  const openSheet = (card) => {
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
    const tea = card.querySelector('.ec-tea');
    if (tea) {
      const d = document.createElement('p');
      d.className = 'sheet-desc';
      d.textContent = tea.textContent.trim();
      panel.appendChild(d);
    }
    // carry the card's aurora custom props so the sheet paints as the card
    const inline = card.getAttribute('style');
    if (inline) panel.setAttribute('style', inline); else panel.removeAttribute('style');
    sheet.classList.add('open');
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('up')));
  };
  const teaOverflows = (el) => !!el && el.scrollHeight > el.clientHeight + 1;
  const markOverflows = () => {
    if (!isMobile() || !isDense()) return;
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
    if (!isMobile() || !isDense()) return;
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

  // ---------- mobile month view: the grid alone; a pill opens its week ----------
  const updateMonthFull = () => {
    const isMonth = !!document.querySelector('.calendar-day.month-day');
    html.classList.toggle('month-full', isMonth && isMobile());
  };
  document.addEventListener('click', (e) => {
    if (!html.classList.contains('month-full') || !e.isTrusted) return;
    const pill = e.target.closest && e.target.closest('.calendar-grid .event-item');
    const day = !pill && e.target.closest && e.target.closest('.calendar-day.month-day');
    if (!pill && !day) return;
    const dayEl = pill ? pill.closest('[data-date]') : day;
    const date = dayEl && dayEl.getAttribute('data-date');
    if (!date) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const l = loader();
    if (!l) return;
    const slug = pill && pill.getAttribute('data-event-slug');
    if (slug && l.openWeekAt) l.openWeekAt(slug, date);
    else if (l.switchToWeekView) l.switchToWeekView(date);
  }, true);

  // ================= the rail =================
  const USER_QUIET = 600;
  const DENSE_MIN = 246;
  const BAND_PAD = 16;
  const V_LO = 0.3, V_HI = 1.2, TAU = 100; // damping: px/ms band + filter time constant

  let touchActive = false, lastUserTouch = -1e9, interacted = false, gestureScrolled = false;
  let railOwner = 'init', landedSlug = null, grantSlug = null;
  let phase = 'idle'; // idle | scrub | settle
  let programmatic = false;
  let geom = [], step = 0, railWidth = 0;
  let committedH = 0, lastBandT = -1;
  let vSmooth = 0, lastFrameSL = -1, lastFrameT = 0;
  let urlDirty = false;
  let frameRaf = 0, holdTimer = 0, holdSlug = null;
  let settleRaf = 0, settleTimer = 0, stillFrames = 0, lastLeft = -1;

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
  const bandBox = () => { const el = list(); return el ? (el.closest('.container') || el.parentElement) : null; };
  const mapSection = () => document.querySelector('.events-map-section');
  const railActive = () => { const el = list(); return !!el && el.classList.contains('rail-active'); };
  const cozyRail = () => isMobile() && !isDense() && railActive();

  const lineHeightOf = (el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    return Number.isFinite(lh) ? lh : Math.round(parseFloat(cs.fontSize) * 1.4);
  };

  // ---------- geometry: measured, never left mutated across a paint ----------
  // buildGeom unlocks every card, reads its expanded metrics, re-locks to the
  // dense state and reads that — ALL in one synchronous task. Layout is
  // forced twice but paint cannot happen between synchronous DOM writes, so
  // nothing ever flashes. Callers MUST follow with commitFrame()/railFrame()
  // in the same task to write the live values back.
  const buildGeom = () => {
    geom = [];
    const el = list();
    if (!el || !el.classList.contains('rail-active')) return;
    railWidth = el.clientWidth;
    const cs = cards();
    if (!cs.length) return;
    const expanding = !isDense();
    geom = cs.map((card) => ({
      el: card,
      slug: card.getAttribute('data-event-slug') || '',
      tea: expanding ? card.querySelector('.ec-tea') : null,
      flyer: expanding ? card.querySelector('.event-flyer') : null,
      thumb: card.querySelector('.rail-thumb'),
      center: 0, teaClamp: 0, teaFull: 0, flyerFull: 0,
      denseH: 0, growth: 0, expandedH: 0,
      lastE: -1, lastTea: -1, lastFly: -1, lastOp: -1, lastThumbOp: -1
    }));
    if (expanding) {
      geom.forEach((g) => {
        if (g.tea) g.tea.style.maxHeight = 'none';
        if (g.flyer) g.flyer.style.maxHeight = 'none';
      });
      geom.forEach((g) => {
        if (g.tea) {
          g.teaFull = g.tea.offsetHeight;
          g.teaClamp = Math.min(g.teaFull, Math.round(2 * lineHeightOf(g.tea)));
        }
        g.flyerFull = g.flyer ? g.flyer.offsetHeight : 0;
        g.expandedH = g.el.offsetHeight;
      });
      geom.forEach((g) => {
        if (g.tea) g.tea.style.maxHeight = g.teaClamp + 'px';
        if (g.flyer) g.flyer.style.maxHeight = '0px';
      });
    }
    geom.forEach((g) => {
      g.denseH = g.el.offsetHeight;
      g.center = g.el.offsetLeft + g.el.offsetWidth / 2;
      g.growth = expanding ? Math.max(0, g.expandedH - g.denseH) : 0;
    });
    step = geom.length > 1
      ? Math.max(1, geom[1].center - geom[0].center)
      : Math.max(1, geom[0].el.offsetWidth || railWidth);
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

  // one card's interpolated state at expansion e (0 dense .. 1 open),
  // 1px write granularity, skip-unchanged
  const applyE = (g, e) => {
    e = e < 0 ? 0 : e > 1 ? 1 : e;
    if (g.tea) {
      const teaPx = Math.round(g.teaClamp + e * (g.teaFull - g.teaClamp));
      if (teaPx !== g.lastTea) { g.tea.style.maxHeight = teaPx + 'px'; g.lastTea = teaPx; }
    }
    if (g.flyer) {
      const flyPx = Math.round(e * g.flyerFull);
      if (flyPx !== g.lastFly) { g.flyer.style.maxHeight = flyPx + 'px'; g.lastFly = flyPx; }
      const op = Math.round(e * 100) / 100;
      if (op !== g.lastOp) { g.flyer.style.opacity = String(op); g.lastOp = op; }
    }
    if (g.thumb) {
      const to = Math.round((1 - e) * 100) / 100;
      if (to !== g.lastThumbOp) { g.thumb.style.opacity = String(to); g.lastThumbOp = to; }
    }
    g.lastE = e;
  };

  const clearBand = () => {
    const box = bandBox();
    if (box) box.style.height = '';
    const m = mapSection();
    if (m) m.style.transform = '';
    committedH = 0; lastBandT = -1; vSmooth = 0; lastFrameSL = -1;
  };
  const clearWrites = () => {
    document.querySelectorAll('.events-list .ec-tea').forEach((t) => { if (t.style.maxHeight) t.style.maxHeight = ''; });
    document.querySelectorAll('.events-list .event-flyer').forEach((f) => { f.style.maxHeight = ''; f.style.opacity = ''; });
    document.querySelectorAll('.events-list .rail-thumb').forEach((t) => { if (t.style.opacity) t.style.opacity = ''; });
  };

  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // ---------- the per-frame writer (cozy rail scrub only) ----------
  // p is a pure function of scroll position with support = the measured
  // center-to-center step, so adjacent cards' p sum to exactly 1 and the
  // band interpolates flat/linear between them instead of pumping.
  const railFrame = () => {
    if (!cozyRail() || !geom.length) return;
    const el = list();
    const sl = el.scrollLeft;
    const now = performance.now();
    if (lastFrameSL >= 0) {
      const dt = Math.max(4, Math.min(64, now - lastFrameT));
      const v = Math.min(5, Math.abs(sl - lastFrameSL) / dt);
      // dt-aware one-pole low-pass; NOTHING ever resets this estimator —
      // a reset mid-gesture is exactly what made damp whipsaw before
      vSmooth += (v - vSmooth) * (1 - Math.exp(-dt / TAU));
    }
    lastFrameSL = sl; lastFrameT = now;
    const damp = 1 - smoothstep(V_LO, V_HI, vSmooth);
    const mid = sl + railWidth / 2;
    let denseBlend = 0, growthSum = 0, wSum = 0;
    for (let i = 0; i < geom.length; i++) {
      const g = geom[i];
      const d = Math.abs(g.center - mid);
      if (d >= step) { applyE(g, 0); continue; }
      const p = 1 - d / step;
      applyE(g, p * damp);
      denseBlend += p * g.denseH;
      growthSum += p * damp * g.growth;
      wSum += p;
    }
    const box = bandBox();
    if (!box) return;
    const t = wSum > 0
      ? Math.round(Math.max(DENSE_MIN, denseBlend / wSum + growthSum)) + BAND_PAD
      : committedH || (DENSE_MIN + BAND_PAD);
    // gesture frames: the band's LAYOUT height stays frozen (zero relayout
    // below the rail); the map rides a compositor transform by the delta
    if (!committedH) {
      committedH = Math.round(parseFloat(box.style.height)) || t;
      if (!box.style.height) box.style.height = committedH + 'px';
    }
    if (t !== lastBandT) {
      lastBandT = t;
      const m = mapSection();
      if (m) {
        const shift = t - committedH;
        m.style.transform = shift ? ('translateY(' + shift + 'px)') : '';
      }
      bandNote('band ' + t + ' damp ' + damp.toFixed(2));
    }
  };

  // ---------- commit: the resting frame (centered card open, others dense) ----------
  const commitFrame = () => {
    const el = list();
    if (!el || !geom.length) return null;
    const best = nearestGeom(el.scrollLeft);
    if (!isDense()) {
      // dense never writes card geometry (fixed 246px boxes, thumbs always
      // on) — the resting frame is a cozy concept
      geom.forEach((g) => applyE(g, g === best ? 1 : 0));
      const t = (best ? Math.max(DENSE_MIN, best.denseH + best.growth) : DENSE_MIN) + BAND_PAD;
      const box = bandBox();
      if (box) box.style.height = t + 'px';
      const m = mapSection();
      if (m) m.style.transform = '';
      committedH = t; lastBandT = t;
      bandNote('commit ' + t);
    }
    return best;
  };

  // ---------- settle: writer OFF first, then one transitioned write ----------
  const settle = (fromUser) => {
    const el = list();
    if (!el) return;
    clearTimeout(holdTimer);
    let bestEl = null;
    if (cozyRail() && geom.length) {
      phase = 'settle';
      el.classList.add('rail-settling'); // enables the ONLY transitions in the system
      const best = commitFrame();
      bestEl = best && best.el;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        el.classList.remove('rail-settling');
        if (phase === 'settle') phase = 'idle';
      }, 200);
    } else {
      phase = 'idle';
      bestEl = centeredCard();
    }
    if (fromUser && bestEl) {
      railOwner = 'user';
      landedSlug = bestEl.getAttribute('data-event-slug') || landedSlug;
      dbgNote('landed ' + (landedSlug || '?').slice(0, 16));
      realSelect(landedSlug);
    }
    flushUrl();
    predecodeNear(bestEl || centeredCard());
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

  // ---------- live selection during the scrub ----------
  // drives the SITE'S real selection (pill spotlight, marker highlight) with
  // the URL write deferred to one flush per gesture
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

  const onScrubFrame = () => {
    frameRaf = 0;
    if (phase !== 'scrub' || !railActive()) return;
    if (geomStale()) buildGeom();
    railFrame();
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
    if (phase === 'settle') return; // transition tail; new input restarts scrub
    if (phase === 'idle' && !programmatic) {
      // wheel/trackpad gestures have no touchstart — do its cleanup here:
      // the writer must never run while settle transitions are enabled
      phase = 'scrub';
      clearTimeout(settleTimer);
      t.classList.remove('rail-settling');
      lastFrameSL = t.scrollLeft;
      lastFrameT = performance.now();
    }
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
    const el = list();
    if (el && el.classList.contains('rail-active')) {
      // a new gesture cancels any settle in flight — transitions off NOW,
      // synchronously, before the finger moves a single pixel
      clearTimeout(settleTimer);
      el.classList.remove('rail-settling');
      phase = 'scrub';
      lastFrameSL = el.scrollLeft;
      lastFrameT = performance.now();
    }
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

  // ---------- rail structure: synchronous, single-frame switches ----------
  let denseMapH = -1;
  const sizeDenseMap = () => {
    const sec = mapSection();
    if (!sec) return;
    if (!isMobile() || !isDense() || html.classList.contains('month-full')) {
      if (sec.style.height) { sec.style.height = ''; sec.style.flex = ''; resizeMap(); }
      denseMapH = -1;
      return;
    }
    const main = document.querySelector('main.city-page');
    if (!main) return;
    const h = Math.max(140, Math.floor(main.getBoundingClientRect().bottom - sec.getBoundingClientRect().top - 6));
    if (h === denseMapH) return;
    denseMapH = h;
    sec.style.height = h + 'px';
    sec.style.flex = 'none';
    resizeMap();
  };

  const selectedSlug = () => { const l = loader(); return (l && l.selectedEventSlug) || null; };

  const enterRail = (targetSlug) => {
    const el = list();
    if (!el) return;
    el.classList.add('rail-active');
    armThumbs();
    buildGeom();
    const target = cardBySlug(targetSlug) || cardBySlug(landedSlug) || cards()[0];
    if (target) {
      landedSlug = target.getAttribute('data-event-slug') || landedSlug;
      if (grantSlug === landedSlug) grantSlug = null;
      const t = Math.round(target.offsetLeft + target.offsetWidth / 2 - el.clientWidth / 2);
      if (Math.abs(el.scrollLeft - t) >= 1) { programmatic = true; el.scrollLeft = t; }
    }
    if (!isDense() && geom.length) {
      // cozy entry is a BLOOM, not a snap: the first paint shows the rail in
      // its dense frame (buildGeom already locked every card to e=0 — just
      // add the thumb opacities and the dense band), then the tapped card
      // eases open under .rail-settling. Double-rAF so the dense keyframe
      // actually paints before the transition starts.
      geom.forEach((g) => applyE(g, 0));
      const b = nearestGeom(el.scrollLeft);
      const box = bandBox();
      if (box && b) {
        committedH = Math.round(b.denseH) + BAND_PAD;
        lastBandT = committedH;
        box.style.height = committedH + 'px';
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!cozyRail() || phase !== 'idle' || touchActive) return;
        el.classList.add('rail-settling');
        commitFrame();
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          el.classList.remove('rail-settling');
          if (phase === 'settle') phase = 'idle';
        }, 200);
      }));
    } else {
      commitFrame(); // dense: same task as the class flip — ONE paint
    }
    resizeMap();
    dbgNote('rail ON');
  };
  const exitRail = () => {
    const el = list();
    if (!el) return;
    clearTimeout(settleTimer);
    el.classList.remove('rail-active', 'rail-settling');
    phase = 'idle';
    clearBand();
    clearWrites();
    const back = cardBySlug(landedSlug);
    geom = [];
    if (back) { try { back.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    resizeMap();
    dbgNote('rail OFF');
  };

  // rebuild + restore after a loader re-render while railed (fresh DOM means
  // all inline writes and geometry are gone; landedSlug is the anchor)
  const restoreRail = () => {
    const el = list();
    if (!el) return;
    armThumbs();
    buildGeom();
    const back = cardBySlug(landedSlug) || cardBySlug(selectedSlug()) || cards()[0];
    if (back) {
      const t = Math.round(back.offsetLeft + back.offsetWidth / 2 - el.clientWidth / 2);
      if (Math.abs(el.scrollLeft - t) >= 1) { programmatic = true; el.scrollLeft = t; }
    }
    commitFrame();
  };

  const syncRailState = (reason) => {
    const el = list();
    if (!el) return;
    if (!isMobile()) {
      if (el.classList.contains('rail-active')) {
        el.classList.remove('rail-active', 'rail-settling');
        phase = 'idle';
        clearBand();
        clearWrites();
        geom = [];
      }
      updateMonthFull();
      return;
    }
    updateMonthFull();
    sizeDenseMap();
    const want = !html.classList.contains('month-full') && (isDense() || !!selectedSlug());
    const has = el.classList.contains('rail-active');
    if (want && !has) enterRail(selectedSlug());
    else if (!want && has) exitRail();
    else if (want && has) {
      if (reason === 'render' || geomStale()) restoreRail();
      else if (reason === 'mode-switch') {
        // the outgoing mode's inline writes (cozy band height, flyer/tea
        // max-heights) must not leak into the incoming one
        clearBand();
        clearWrites();
        buildGeom();
        commitFrame();
      }
      else if (grantSlug) {
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

  // ---------- image loads: per-card re-measure, never a whole-rail reset ----------
  const remeasureCard = (card) => {
    if (!cozyRail()) return;
    const g = geom.find((x) => x.el === card);
    if (!g || !g.flyer) return;
    if (g.tea) g.tea.style.maxHeight = 'none';
    g.flyer.style.maxHeight = 'none';
    g.flyerFull = g.flyer.offsetHeight;
    if (g.tea) {
      g.teaFull = g.tea.offsetHeight;
      g.teaClamp = Math.min(g.teaFull, Math.round(2 * lineHeightOf(g.tea)));
    }
    const expandedH = g.el.offsetHeight;
    if (g.tea) g.tea.style.maxHeight = g.teaClamp + 'px';
    g.flyer.style.maxHeight = '0px';
    g.denseH = g.el.offsetHeight;
    g.growth = Math.max(0, expandedH - g.denseH);
    g.lastE = -1; g.lastTea = -1; g.lastFly = -1; g.lastOp = -1; g.lastThumbOp = -1;
    const el = list();
    if (phase === 'scrub') {
      railFrame(); // the writer's next pass would fix it anyway; do it now
    } else if (nearestGeom(el.scrollLeft) === g) {
      // the centered, settled card just got its art — grow it smoothly
      el.classList.add('rail-settling');
      commitFrame();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        el.classList.remove('rail-settling');
        // this timer can replace settle()'s own — carry its phase reset or
        // an image landing in the settle tail wedges phase at 'settle'
        if (phase === 'settle') phase = 'idle';
      }, 200);
    } else {
      applyE(g, 0);
      commitFrame();
    }
  };
  const onImgEvent = (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.closest) return;
    const flyer = img.closest('.events-list .event-flyer');
    if (!flyer) return;
    const card = flyer.closest('.event-card');
    if (card) remeasureCard(card);
  };
  document.addEventListener('load', onImgEvent, true);
  document.addEventListener('error', onImgEvent, true);

  const predecodeNear = (centerCard) => {
    if (!centerCard || !isMobile() || !railActive()) return;
    const cs = cards();
    const i = cs.indexOf(centerCard);
    if (i < 0) return;
    for (let k = Math.max(0, i - 2); k <= Math.min(cs.length - 1, i + 2); k++) {
      const img = cs[k].querySelector('.event-flyer img');
      if (!img) continue;
      if (img.loading === 'lazy') img.loading = 'eager';
      if (img.decode) img.decode().catch(() => {});
    }
  };

  // ---------- the two loader events + environment changes ----------
  document.addEventListener('chunky:selection-changed', () => syncRailState('selection'));
  document.addEventListener('chunky:events-rendered', () => {
    armThumbs();
    markOverflows();
    syncRailState('render');
    predecodeNear(centeredCard());
  });
  window.addEventListener('resize', () => {
    denseMapH = -1;
    if (railActive() && isMobile()) {
      buildGeom();
      if (!isDense()) commitFrame();
    }
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
    mountToggle();
    armThumbs();
    syncRailState('boot');
  });
  mountToggle();
  syncRailState('boot');

  // ---------- debug surface ----------
  window.duskRail = {
    setMode,
    openLightbox,
    openSheet,
    state: () => ({
      mode, phase, railOwner, landedSlug, grantSlug, touchActive,
      programmatic, interacted, committedH, vSmooth: Math.round(vSmooth * 100) / 100,
      railActive: railActive()
    }),
    geom: () => geom.map((g) => ({
      slug: g.slug.slice(0, 14), denseH: g.denseH, growth: g.growth,
      flyerFull: g.flyerFull, lastE: g.lastE
    })),
    settle: () => settle(false)
  };
})();

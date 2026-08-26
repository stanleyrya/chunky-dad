// Dusk city-page UI mechanics — ported from the approved demo overlay
// (2026-08-21). Runs at the end of <body> so its first pass lands before
// first paint. Everything here is display-side composition on top of the
// loader's renders: header mounting, per-event pill colours, multi-day
// lane packing and flowing labels, card masonry, per-view map homing.
// The loader owns data and rendering; this file owns arrangement.
(function () {
    // The dusk scope class lives on <html> — the site's own JS rewrites the
    // body class at load time, so body is not a safe carrier for it.
    if (!document.documentElement.classList.contains('dusk')) return;

    // ==== aurora derivation, ported verbatim from js/dynamic-calendar-loader.js ====
    const AURORA_BASE_RGB = { r: 23, g: 26, b: 51 };
    const AURORA_MIN_CHROMA = 0.05;
    const AURORA_MIN_STOP_SHARE = 0.10;
    const AURORA_MIN_SEPARATION = 0.2;
    const AURORA_SIBLING_LIGHTNESS = 0.55;
    const AURORA_SIBLING_CHROMA_BOOST = 1.12;

    function parseHexColor(hex) {
        const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return null;
        let v = m[1];
        if (v.length === 3) v = v.split('').map(c => c + c).join('');
        return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
    }
    function rgbToHexColor(rgb) {
        const ch = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
        return `#${ch(rgb.r)}${ch(rgb.g)}${ch(rgb.b)}`;
    }
    function mixRgbColors(from, to, amount) {
        return { r: from.r + (to.r - from.r) * amount, g: from.g + (to.g - from.g) * amount, b: from.b + (to.b - from.b) * amount };
    }
    function rgbBrightness(rgb) { return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255; }
    function toneForAurora(rgb, minB, maxB) {
        const b = rgbBrightness(rgb);
        if (b > maxB) { const s = maxB / b; return { r: rgb.r * s, g: rgb.g * s, b: rgb.b * s }; }
        if (b < minB) { const a = (minB - b) / (1 - b); return mixRgbColors(rgb, { r: 255, g: 255, b: 255 }, a); }
        return rgb;
    }
    function rgbColorfulness(rgb) {
        const max = Math.max(rgb.r, rgb.g, rgb.b), min = Math.min(rgb.r, rgb.g, rgb.b);
        return max <= 0 ? 0 : (max - min) / max;
    }
    function rgbSeparation(a, b) {
        const l = rgbBrightness(a) - rgbBrightness(b);
        const rg = ((a.r - a.g) - (b.r - b.g)) / 255;
        const yb = (((a.r + a.g) / 2 - a.b) - ((b.r + b.g) / 2 - b.b)) / 255;
        return Math.sqrt(l * l + rg * rg + yb * yb);
    }
    function deepenRgb(rgb, lf, cb = 1) {
        const mean = (rgb.r + rgb.g + rgb.b) / 3;
        const push = c => Math.max(0, Math.min(255, (mean + (c - mean) * cb) * lf));
        return { r: push(rgb.r), g: push(rgb.g), b: push(rgb.b) };
    }
    function parsePaletteEntries(palette) {
        if (typeof palette !== 'string') return [];
        const entries = [];
        palette.trim().split(/\s+/).forEach(token => {
            const parts = token.split(':');
            const rgb = parseHexColor(parts[0]);
            if (!rgb) return;
            entries.push({ rgb, share: Math.max(0, Number(parts[1]) || 0) / 100, chroma: Math.max(0, Number(parts[2]) || 0) / 100 });
        });
        return entries;
    }
    function deriveAuroraFromPalette(entries, accentRgb) {
        if (!accentRgb) return deriveAchromaticAurora(entries);
        const candidates = entries
            .filter(e => e.chroma >= AURORA_MIN_CHROMA && e.share >= AURORA_MIN_STOP_SHARE)
            .map(e => ({ rgb: e.rgb, separation: rgbSeparation(e.rgb, accentRgb) }))
            .filter(c => c.separation >= AURORA_MIN_SEPARATION)
            .sort((a, b) => b.separation - a.separation);
        const second = candidates.length > 0 ? candidates[0].rgb
            : deepenRgb(accentRgb, AURORA_SIBLING_LIGHTNESS, AURORA_SIBLING_CHROMA_BOOST);
        return bandAuroraStops(accentRgb, second, 0.2, 0.52, 0.16, 0.48);
    }
    function deriveAchromaticAurora(entries) {
        if (entries.length === 0) return null;
        const sorted = [...entries].sort((a, b) => rgbBrightness(b.rgb) - rgbBrightness(a.rgb));
        const tint = rgb => mixRgbColors(rgb, AURORA_BASE_RGB, 0.45);
        return bandAuroraStops(tint(sorted[0].rgb), tint(sorted[sorted.length - 1].rgb), 0.22, 0.4, 0.06, 0.14);
    }
    function bandAuroraStops(first, second, fMin, fMax, sMin, sMax) {
        const c1 = toneForAurora(first, fMin, fMax);
        const c2 = toneForAurora(second, sMin, sMax);
        const blended = mixRgbColors(c1, c2, 0.5);
        return {
            c1: rgbToHexColor(c1),
            c2: rgbToHexColor(c2),
            c3: rgbToHexColor(toneForAurora(mixRgbColors(blended, AURORA_BASE_RGB, 0.62), 0.05, 0.22))
        };
    }
    function deriveAuroraColors(record) {
        if (!record) return null;
        const entries = parsePaletteEntries(record.palette);
        if (entries.length > 0) return deriveAuroraFromPalette(entries, parseHexColor(record.accent));
        const bg = parseHexColor(record.faviconBg);
        if (!bg) return null;
        const fg = parseHexColor(record.faviconFg) || bg;
        if (Math.max(rgbColorfulness(bg), rgbColorfulness(fg)) < 0.18) return null;
        const blended = mixRgbColors(bg, fg, 0.5);
        return {
            c1: rgbToHexColor(toneForAurora(bg, 0.18, 0.5)),
            c2: rgbToHexColor(toneForAurora(fg, 0.18, 0.5)),
            c3: rgbToHexColor(toneForAurora(mixRgbColors(blended, AURORA_BASE_RGB, 0.6), 0.05, 0.22))
        };
    }

    // ==== color lookup ====
    let recordsBySlug = null;
    function currentCity() {
        const m = /[?&]city=([a-z0-9-]+)/i.exec(window.location.search);
        if (m) return m[1].toLowerCase();
        const seg = window.location.pathname.split('/').filter(Boolean)[0];
        return seg && !/\.html?$/.test(seg) ? seg.toLowerCase() : 'nyc';
    }
    function loadColors() {
        return fetch(`/data/event-colors/${currentCity()}.json`)
            .then(r => (r.ok ? r.json() : []))
            .catch(() => [])
            .then(list => {
                recordsBySlug = new Map();
                (Array.isArray(list) ? list : []).forEach(rec => {
                    if (rec && rec.slug) recordsBySlug.set(rec.slug, rec);
                });
            });
    }

    const derived = new Map(); // slug -> {aurora, acc, accBright} | null
    function colorsFor(slug) {
        if (!recordsBySlug) return null;
        if (derived.has(slug)) return derived.get(slug);
        const rec = recordsBySlug.get(slug);
        const aurora = deriveAuroraColors(rec);
        let out = null;
        if (aurora) {
            const raw = (rec && parseHexColor(rec.accent)) || parseHexColor(aurora.c1);
            out = {
                aurora,
                acc: rgbToHexColor(toneForAurora(raw, 0.22, 0.5)),
                accBright: rgbToHexColor(toneForAurora(raw, 0.62, 0.85))
            };
        }
        derived.set(slug, out);
        return out;
    }

    // ==== apply to the grid pills ====
    function paintPills() {
        if (recordsBySlug) {
            document.querySelectorAll('.event-item[data-event-slug]').forEach(pill => {
                const c = colorsFor(pill.getAttribute('data-event-slug'));
                if (!c) return;
                pill.style.setProperty('--c1', c.aurora.c1);
                pill.style.setProperty('--c2', c.aurora.c2);
                pill.style.setProperty('--acc', c.acc);
                pill.style.setProperty('--accBright', c.accBright);
            });
        }
        paintMultiDayRuns();
    }

    // Multi-day events render as one segment per day cell. Stamp each segment
    // with the run length and its offset so a single oversized gradient
    // continues seamlessly across the cells and reads as ONE item.
    const chunkRun = segments => {
        // Group the run's segments by visual row; the first segment in a
        // row keeps its text and gets the row-chunk's pixel width so the
        // words can flow across the whole bar.
        segments.forEach(el => {
            el.classList.remove('md-chunk-lead', 'md-chunk-follow');
            el.style.removeProperty('--chunkw');
            const nameEl = el.querySelector('.event-name');
            if (nameEl) { nameEl.style.removeProperty('width'); nameEl.style.removeProperty('max-width'); }
        });
        let chunk = [];
        const flushChunk = () => {
            if (!chunk.length) return;
            const lead = chunk[0];
            lead.classList.add('md-chunk-lead');
            chunk.slice(1).forEach(el => el.classList.add('md-chunk-follow'));
            const first = lead.getBoundingClientRect();
            const last = chunk[chunk.length - 1].getBoundingClientRect();
            const chunkWidth = Math.max(first.width, last.right - first.left);
            lead.style.setProperty('--chunkw', `${chunkWidth}px`);
            // Inline pixel width on the name itself — Safari resolves the
            // max-content/var() combination differently, so don't rely on it
            const leadName = lead.querySelector('.event-name');
            if (leadName && chunkWidth > 0) {
                leadName.style.width = `${Math.max(20, chunkWidth - 12)}px`;
                leadName.style.maxWidth = 'none';
                // The site's smart-name logic truncates the STRING to one
                // cell's width before we ever get here — give the lead the
                // real name and let CSS ellipsis do any needed trimming.
                // (Guarded: only write on change, or the MutationObserver
                // would refire forever.)
                const slug = lead.getAttribute('data-event-slug');
                const events = (window.calendarLoader && window.calendarLoader.allEvents) || [];
                const ev = events.find(e => e && e.slug === slug);
                const label = ev ? (ev.shortName || ev.nickname || ev.name) : null;
                if (label && leadName.textContent !== label) leadName.textContent = label;
            }
            chunk = [];
        };
        let rowTop = null;
        segments.forEach(el => {
            const top = Math.round(el.getBoundingClientRect().top);
            if (rowTop !== null && Math.abs(top - rowTop) > 4) flushChunk();
            rowTop = top;
            chunk.push(el);
        });
        flushChunk();
    };

    function paintMultiDayRuns() {
        const segs = [...document.querySelectorAll('.event-item.multi-day[data-event-slug]')];
        // Group by event first: two multi-day events running in parallel
        // interleave in document order and would scramble run detection.
        const bySlug = new Map();
        segs.forEach(el => {
            const key = el.getAttribute('data-event-slug') || '';
            if (!bySlug.has(key)) bySlug.set(key, []);
            bySlug.get(key).push(el);
        });
        bySlug.forEach(group => {
            const n = group.length;
            group.forEach((el, i) => {
                el.style.setProperty('--mdspan', n);
                el.style.setProperty('--mdpos', n > 1 ? `${(i / (n - 1)) * 100}%` : '0%');
            });
            chunkRun(group);
        });
    }

    // Re-render happens via wholesale innerHTML swaps — observe and repaint.
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; refreshAll(); });
    });


    // Move the calendar controls into a second row of the purple header
    // (event-builder mechanism: the header is one auto-height block and its
    // real height is measured into --hdr-h for the body padding).
    function mountControlsInHeader() {
        const nav = document.querySelector('header nav');
        const controls = document.querySelector('.calendar-controls');
        if (!nav || !controls) return;
        let row = nav.querySelector('.header-controls-row');
        if (!row) {
            row = document.createElement('div');
            row.className = 'header-controls-row';
            nav.appendChild(row);
        }
        if (controls.parentElement !== row) row.appendChild(controls);
        // desktop: the picker PHYSICALLY sits beside the city switcher —
        // position by structure, not by flex-margin arithmetic
        const toggle = document.querySelector('.view-toggle');
        const switcher = document.querySelector('header .city-switcher');
        if (toggle && switcher) {
            if (window.innerWidth >= 769) {
                if (toggle.nextElementSibling !== switcher) switcher.before(toggle);
            } else if (toggle.parentElement !== controls) {
                controls.appendChild(toggle);
            }
        }
        const labels = { week: 'Week', month: 'Month' };
        document.querySelectorAll('.view-btn').forEach(btn => {
            const view = btn.getAttribute('data-view');
            if (labels[view]) btn.textContent = labels[view];
        });
        const prev = document.getElementById('prev-period');
        const next = document.getElementById('next-period');
        if (prev) prev.textContent = '\u2039';
        if (next) next.textContent = '\u203a';
        // header row is (re)assembled \u2014 dusk-rail mounts its mode toggle on
        // this, riding the same observer/refresh cadence with no timers
        document.dispatchEvent(new CustomEvent('dusk:controls-mounted'));
    }

    function trackHeaderHeight() {
        const header = document.querySelector('header');
        if (!header) return;
        const set = () => {
            document.documentElement.style.setProperty('--hdr-h', header.offsetHeight + 'px');
            // header height shifts the whole page — the week map must re-size
            requestAnimationFrame(() => { try { sizeWeekMap(); } catch (e) {} });
        };
        if (window.ResizeObserver) new ResizeObserver(set).observe(header);
        window.addEventListener('resize', set);
        set();
    }

    // One event = one lane across a week row. The site stacks each cell
    // independently, so a run's segments land at different heights and the
    // bar reads broken. Assign lanes per row and hold empty lanes open with
    // transparent spacers; the signature guard keeps the MutationObserver
    // from re-triggering forever.
    function alignMultiDayLanes() {
        const cells = [...document.querySelectorAll('.calendar-day[data-date]')];
        if (!cells.length) return;
        const rows = [];
        cells.forEach(cell => {
            const top = Math.round(cell.getBoundingClientRect().top);
            let row = rows.find(r => Math.abs(r.top - top) < 4);
            if (!row) { row = { top, cells: [] }; rows.push(row); }
            row.cells.push(cell);
        });
        rows.forEach(row => {
            row.cells.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
            // first-fit lane packing: earlier/longer runs claim lanes first,
            // and a later run slots UP into any lane that is free over its
            // span (interweave) instead of always cascading downwards
            const coverage = new Map();
            row.cells.forEach((cell, ci) => {
                cell.querySelectorAll('.event-item.multi-day[data-event-slug]').forEach(p => {
                    const slug = p.getAttribute('data-event-slug');
                    if (!coverage.has(slug)) coverage.set(slug, { min: ci, max: ci });
                    const c = coverage.get(slug);
                    c.min = Math.min(c.min, ci);
                    c.max = Math.max(c.max, ci);
                });
            });
            const runs = [...coverage.entries()]
                .sort((a, b) => (a[1].min - b[1].min)
                    || ((b[1].max - b[1].min) - (a[1].max - a[1].min))
                    || (a[0] < b[0] ? -1 : 1));
            if (!runs.length) return;
            const laneRuns = []; // lane index -> [{slug,min,max}]
            runs.forEach(([slug, c]) => {
                let li = 0;
                while (laneRuns[li] && laneRuns[li].some(o => !(c.max < o.min || c.min > o.max))) li++;
                if (!laneRuns[li]) laneRuns[li] = [];
                laneRuns[li].push({ slug, min: c.min, max: c.max });
            });
            row.cells.forEach((cell) => {
                const container = cell.querySelector('.day-events') || cell.querySelector('.daily-events');
                if (!container) return;
                const bySlug = new Map();
                container.querySelectorAll('.event-item.multi-day[data-event-slug]').forEach(p =>
                    bySlug.set(p.getAttribute('data-event-slug'), p));
                const ci = row.cells.indexOf(cell);
                const slotSlugs = laneRuns.map(list => {
                    const o = list.find(o => o.min <= ci && ci <= o.max);
                    return o && bySlug.has(o.slug) ? o.slug : null;
                });
                let maxActive = -1;
                slotSlugs.forEach((slug, li) => { if (slug) maxActive = li; });
                const sig = slotSlugs.slice(0, maxActive + 1)
                    .map(slug => (slug ? 'p:' + slug : 's')).join('|');
                if (cell.dataset.mdLaneSig === sig) return;
                cell.dataset.mdLaneSig = sig;
                container.querySelectorAll('.md-lane-spacer').forEach(sp => sp.remove());
                const ordered = [];
                for (let li = 0; li <= maxActive; li++) {
                    if (slotSlugs[li]) ordered.push(bySlug.get(slotSlugs[li]));
                    else {
                        // a real (invisible) pill skeleton: always exactly lane
                        // height, with no measurement race against font loading
                        const spacer = document.createElement('div');
                        spacer.className = 'event-item multi-day md-lane-spacer';
                        spacer.innerHTML = '<div class="event-name">&nbsp;</div><div class="event-time">&nbsp;</div>';
                        ordered.push(spacer);
                    }
                }
                const rest = [...container.children].filter(n => !ordered.includes(n));
                ordered.concat(rest).forEach(n => container.appendChild(n));
            });
        });
    }

    // Desktop right rail: events + map become one pinned flex column so
    // the geometry is structural instead of sticky-offset arithmetic.
    function mountRightRail() {
        const page = document.querySelector('main.city-page');
        if (!page) return;
        const ev = page.querySelector('.events');
        const map = page.querySelector('.events-map-section');
        if (!ev || !map) return;
        let rail = page.querySelector(':scope > .right-rail');
        if (window.innerWidth < 769) {
            if (rail) { rail.before(ev, map); rail.remove(); }
            return;
        }
        if (!rail) {
            rail = document.createElement('div');
            rail.className = 'right-rail';
            (map.parentElement === page ? map : ev).before(rail);
        }
        // week: map on the page (bottom-left). Month: page middle column
        // when three columns fit (>=1200), else it rides the rail under the
        // cards.
        const isWeekView = !!page.querySelector('.calendar-grid.week-view-grid');
        const mapHome = (isWeekView || window.innerWidth >= 1200) ? page : rail;
        let moved = false;
        if (ev.parentElement !== rail) { rail.appendChild(ev); moved = true; }
        if (map.parentElement !== mapHome) { mapHome.appendChild(map); moved = true; }
        // maplibre sizes its canvas to the container — nudge it after re-homing
        if (moved) setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    }

    // Week view: the map must fill from under the grid to the page bottom.
    // Percentage heights through grid tracks proved racy against the site's
    // re-renders — set the pixel height directly and converge.
    function sizeWeekMap() {
        const page = document.querySelector('main.city-page');
        const mapEl = document.getElementById('events-map');
        if (!page || !mapEl) return;
        const sec = mapEl.closest('.events-map-section');
        const onPage = sec && sec.parentElement === page;
        const isWeek = window.innerWidth >= 769 && onPage && !!page.querySelector('.calendar-grid.week-view-grid');
        const isMonth = window.innerWidth >= 1200 && onPage && !!page.querySelector('.calendar-grid.month-view-grid');
        let want = null;
        if (isWeek) {
            const pageRect = page.getBoundingClientRect();
            const cal = page.querySelector('.weekly-calendar');
            const calBottom = cal ? cal.getBoundingClientRect().bottom : pageRect.top;
            want = Math.max(220, Math.round(pageRect.bottom - calBottom - 20));
        } else if (isMonth) {
            // the section's height is a viewport calc; the map fills it
            const secRect = sec.getBoundingClientRect();
            want = Math.max(240, Math.round(secRect.bottom - mapEl.getBoundingClientRect().top - 6));
        }
        if (want === null) {
            if (mapEl.style.height) {
                mapEl.style.height = '';
                window.dispatchEvent(new Event('resize'));
            }
            return;
        }
        if (Math.abs(mapEl.getBoundingClientRect().height - want) > 4) {
            mapEl.style.height = `${want}px`;
            window.dispatchEvent(new Event('resize'));
        }
    }

    // Masonry interweave: place each card, in order, into whichever column
    // is currently shorter — a short card never strands a half-empty row.
    // Below desktop the columns dissolve via CSS (display: contents), and on
    // a resize down we physically unwrap so DOM order returns to chronology.
    function interleaveCards() {
        const list = document.querySelector('.events-list');
        if (!list) return;
        const cols = list.querySelectorAll(':scope > .ml-col');
        const monthDesktop = window.innerWidth >= 769
            && !!document.querySelector('.calendar-grid.month-view-grid');
        // two fixed 400px columns need the room — below that, one ordered file
        const tooNarrow = list.getBoundingClientRect().width < 2 * 400 + 16;
        if (window.innerWidth < 769 || monthDesktop || tooNarrow) {
            if (cols.length) {
                const cards = [...list.querySelectorAll('.ml-col > *')]
                    .sort((a, b) => (+a.dataset.mlIndex || 0) - (+b.dataset.mlIndex || 0));
                cards.forEach(c => list.appendChild(c));
                cols.forEach(c => c.remove());
            }
            return;
        }
        const orphans = [...list.children].filter(n =>
            n.classList && n.classList.contains('event-card'));
        if (!orphans.length) return;
        let colA = list.querySelector(':scope > .ml-col.a');
        let colB = list.querySelector(':scope > .ml-col.b');
        if (!colA) {
            colA = document.createElement('div'); colA.className = 'ml-col a';
            colB = document.createElement('div'); colB.className = 'ml-col b';
            list.append(colA, colB);
        }
        orphans.forEach((card, i) => {
            card.dataset.mlIndex = String(i);
            const hA = colA.getBoundingClientRect().height;
            const hB = colB.getBoundingClientRect().height;
            // heights can both read ~0 before layout/images settle — fall
            // back to strict alternation so column A never swallows the lot
            const target = (hA < 10 && hB < 10)
                ? (colA.childElementCount <= colB.childElementCount ? colA : colB)
                : (hA <= hB ? colA : colB);
            target.appendChild(card);
        });
    }

    // Today only earns a spot when today's cell is not on screen.
    function updateTodayChip() {
        const row = document.querySelector('.header-controls-row');
        if (!row) return;
        if (!document.querySelector('.calendar-grid .calendar-day')) return;
        // the continuous strip always RENDERS today's cell when it's within
        // the buffer — the chip must key off whether it's actually in the
        // scroller's viewport, not off DOM presence
        const cur = document.querySelector('.calendar-grid .calendar-day.current');
        let visible = false;
        if (cur) {
            const grid = cur.closest('.calendar-grid');
            if (grid) {
                const gr = grid.getBoundingClientRect();
                const r = cur.getBoundingClientRect();
                visible = r.right > gr.left + 4 && r.left < gr.right - 4 &&
                          r.bottom > gr.top + 4 && r.top < gr.bottom - 4;
            } else {
                visible = true;
            }
        }
        row.classList.toggle('off-today', !visible);
    }
    // strip scrolling changes today's visibility without any DOM mutation —
    // re-evaluate the chip on grid scroll (debounced; capture: scroll
    // events don't bubble)
    let todayChipT = 0;
    document.addEventListener('scroll', (e) => {
        const t = e.target;
        if (!t || !t.classList || !t.classList.contains('calendar-grid')) return;
        clearTimeout(todayChipT);
        todayChipT = setTimeout(updateTodayChip, 180);
    }, { capture: true, passive: true });

    function refreshAll() {
        mountControlsInHeader();
        alignMultiDayLanes();
        paintPills();
        mountRightRail();
        sizeWeekMap();
        interleaveCards();
        updateTodayChip();
    }

    // The static markup hardcodes WEEK as active; the loader corrects it
    // from the URL during its (async) init — this pre-paint pass prevents
    // the wrong underline from ever being painted at all.
    (function () {
        try {
            const m = /[?&]view=(week|month)/.exec(window.location.search);
            if (!m) return;
            document.querySelectorAll('.view-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-view') === m[1]);
            });
        } catch (e) {}
    })();

    // Mount immediately — this script runs at the end of <body>, so the
    // controls are already in the header on the very first paint and the
    // header never grows after load.
    mountControlsInHeader();
    trackHeaderHeight();
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', () => refreshAll());
    // chunk widths and lane heights depend on final font metrics — do a
    // full refresh once fonts land
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => refreshAll());
    loadColors().then(() => refreshAll());
})();

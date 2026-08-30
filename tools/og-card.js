/**
 * og-card.js — the share image, built from the site's own card design.
 *
 * One 1200×630 composition, shared by two callers so they can never drift:
 *   tools/generate-og-images.js   renders it in puppeteer and commits the PNG
 *   testing/test-og-event-layouts-calendar.html   previews it in an iframe
 *
 * It is the aurora event card (styles.css, `.event-card.detailed.aurora`)
 * unfolded for a landscape artboard: the same three-stop gradient built from
 * the event's own artwork, the same frosted glass panel carrying every piece
 * of information, the same favicon tile, the same icon rows — with the flyer
 * beside the panel instead of above it, because 1200×630 is wide and a card
 * is tall.
 *
 * COLOUR MATH BELOW IS A PORT. The reference implementation is
 * js/dynamic-calendar-loader.js (parseHexColor → deriveAuroraColors, plus the
 * AURORA_* constants at the top of that file). It lives twice on purpose: the
 * loader is a browser class the whole site depends on, and the share images
 * must not be able to break the live cards. Change one, change the other —
 * the two are meant to produce identical stops for the same event.
 */

// Wrapped in an IIFE, and NOT re-indented inside it (UMD convention, and it
// keeps this file diffable against the loader it is ported from). The reason
// is concrete: this ships as a plain <script> on the OG studio page alongside
// js/dynamic-calendar-loader.js, which declares AURORA_BASE_RGB at top level
// too — two `const`s of that name in one global scope is a SyntaxError that
// takes the whole page down with it.
(function (root) {
'use strict';

// ── Aurora tuning: identical to the loader's constants ───────────────────────
const AURORA_BASE_RGB = { r: 23, g: 26, b: 51 };   // the card ground, #171a33
const AURORA_MIN_CHROMA = 0.05;
const AURORA_MIN_STOP_SHARE = 0.10;
const AURORA_MIN_SEPARATION = 0.2;
const AURORA_SIBLING_LIGHTNESS = 0.55;
const AURORA_SIBLING_CHROMA_BOOST = 1.12;

// The site palette, used when an event has no readable artwork at all —
// the same fallback the card's CSS declares.
const AURORA_FALLBACK = { c1: '#667eea', c2: '#ff6b6b', c3: '#2a2c4d' };

// Bumping this changes every share image, so it also has to change the `?v=`
// on every og:image URL — otherwise Facebook, iMessage and friends keep
// serving the card they cached before the redesign. tools/generate-event-pages.js
// mixes it into the cache-busting hash for exactly that reason.
const OG_TEMPLATE_VERSION = 2;

// Bootstrap Icons geometry, inlined — same paths the cards use.
const OG_ICONS = {
    clock: [
        'M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z',
        'M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z'
    ],
    pin: ['M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z'],
    cash: ['M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.29 0-1.53-.9-2.377-2.849-2.838l-.829-.194V3.885c1.135.148 1.856.749 2.028 1.578h1.549c-.14-1.577-1.475-2.759-3.577-2.912V1H7.591v1.55c-1.9.192-3.328 1.396-3.328 3.156 0 1.462.943 2.472 2.653 2.873l.674.163v3.949c-1.156-.168-1.918-.789-2.09-1.91H4zm3.559-1.66c-1.086-.263-1.663-.766-1.663-1.545 0-.784.598-1.386 1.6-1.512v3.057h.063zm1.184 1.35c1.303.325 1.94.813 1.94 1.71 0 .952-.716 1.585-1.94 1.71v-3.42z']
};

// ── colour helpers (ported) ──────────────────────────────────────────────────
function parseHexColor(hex) {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!match) return null;
    let value = match[1];
    if (value.length === 3) value = value.split('').map(c => c + c).join('');
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
    };
}

function rgbToHexColor(rgb) {
    const channel = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function mixRgbColors(from, to, amount) {
    return {
        r: from.r + (to.r - from.r) * amount,
        g: from.g + (to.g - from.g) * amount,
        b: from.b + (to.b - from.b) * amount
    };
}

function rgbBrightness(rgb) {
    return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function toneForAurora(rgb, minBrightness, maxBrightness) {
    const brightness = rgbBrightness(rgb);
    if (brightness > maxBrightness) {
        const scale = maxBrightness / brightness;
        return { r: rgb.r * scale, g: rgb.g * scale, b: rgb.b * scale };
    }
    if (brightness < minBrightness) {
        const amount = (minBrightness - brightness) / (1 - brightness);
        return mixRgbColors(rgb, { r: 255, g: 255, b: 255 }, amount);
    }
    return rgb;
}

function rgbColorfulness(rgb) {
    const max = Math.max(rgb.r, rgb.g, rgb.b);
    const min = Math.min(rgb.r, rgb.g, rgb.b);
    return max <= 0 ? 0 : (max - min) / max;
}

function rgbSeparation(a, b) {
    const lightness = rgbBrightness(a) - rgbBrightness(b);
    const redGreen = ((a.r - a.g) - (b.r - b.g)) / 255;
    const yellowBlue = (((a.r + a.g) / 2 - a.b) - ((b.r + b.g) / 2 - b.b)) / 255;
    return Math.sqrt(lightness * lightness + redGreen * redGreen + yellowBlue * yellowBlue);
}

function deepenRgb(rgb, lightnessFactor, chromaBoost = 1) {
    const mean = (rgb.r + rgb.g + rgb.b) / 3;
    const push = channel => Math.max(0, Math.min(255, (mean + (channel - mean) * chromaBoost) * lightnessFactor));
    return { r: push(rgb.r), g: push(rgb.g), b: push(rgb.b) };
}

// Packed `hex:share:chroma` tokens written by tools/extract-favicon-colors.js.
function parsePaletteEntries(palette) {
    if (typeof palette !== 'string') return [];
    const entries = [];
    palette.trim().split(/\s+/).forEach(token => {
        const parts = token.split(':');
        const rgb = parseHexColor(parts[0]);
        if (!rgb) return;
        entries.push({
            rgb,
            share: Math.max(0, Number(parts[1]) || 0) / 100,
            chroma: Math.max(0, Number(parts[2]) || 0) / 100
        });
    });
    return entries;
}

function bandAuroraStops(first, second, firstMin, firstMax, secondMin, secondMax) {
    const c1 = toneForAurora(first, firstMin, firstMax);
    const c2 = toneForAurora(second, secondMin, secondMax);
    const blended = mixRgbColors(c1, c2, 0.5);
    return {
        c1: rgbToHexColor(c1),
        c2: rgbToHexColor(c2),
        c3: rgbToHexColor(toneForAurora(mixRgbColors(blended, AURORA_BASE_RGB, 0.62), 0.05, 0.22))
    };
}

function deriveAchromaticAurora(entries) {
    if (entries.length === 0) return null;
    const sorted = [...entries].sort((a, b) => rgbBrightness(b.rgb) - rgbBrightness(a.rgb));
    const tint = rgb => mixRgbColors(rgb, AURORA_BASE_RGB, 0.45);
    return bandAuroraStops(tint(sorted[0].rgb), tint(sorted[sorted.length - 1].rgb), 0.22, 0.4, 0.06, 0.14);
}

function deriveAuroraFromPalette(entries, accentRgb) {
    if (!accentRgb) return deriveAchromaticAurora(entries);
    const candidates = entries
        .filter(entry => entry.chroma >= AURORA_MIN_CHROMA && entry.share >= AURORA_MIN_STOP_SHARE)
        .map(entry => ({ rgb: entry.rgb, separation: rgbSeparation(entry.rgb, accentRgb) }))
        .filter(candidate => candidate.separation >= AURORA_MIN_SEPARATION)
        .sort((a, b) => b.separation - a.separation);
    const second = candidates.length > 0
        ? candidates[0].rgb
        : deepenRgb(accentRgb, AURORA_SIBLING_LIGHTNESS, AURORA_SIBLING_CHROMA_BOOST);
    return bandAuroraStops(accentRgb, second, 0.2, 0.52, 0.16, 0.48);
}

/**
 * Three aurora stops for one data/event-colors record
 * ({ faviconBg, faviconFg, palette, accent }). Returns null when the artwork
 * holds nothing to build a gradient from; callers fall back to AURORA_FALLBACK.
 */
function deriveAuroraColors(record) {
    if (!record) return null;
    const entries = parsePaletteEntries(record.palette);
    if (entries.length > 0) {
        return deriveAuroraFromPalette(entries, parseHexColor(record.accent));
    }
    const backgroundRgb = parseHexColor(record.faviconBg || record.bg);
    if (!backgroundRgb) return null;
    const foregroundRgb = parseHexColor(record.faviconFg || record.fg) || backgroundRgb;
    const colorfulness = Math.max(rgbColorfulness(backgroundRgb), rgbColorfulness(foregroundRgb));
    if (colorfulness < 0.18) return null;
    const blended = mixRgbColors(backgroundRgb, foregroundRgb, 0.5);
    return {
        c1: rgbToHexColor(toneForAurora(backgroundRgb, 0.18, 0.5)),
        c2: rgbToHexColor(toneForAurora(foregroundRgb, 0.18, 0.5)),
        c3: rgbToHexColor(toneForAurora(mixRgbColors(blended, AURORA_BASE_RGB, 0.6), 0.05, 0.22))
    };
}

// ── markup ───────────────────────────────────────────────────────────────────
function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"]/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
    ));
}

// Only http(s), file: and root-relative URLs reach the document — everything
// here is interpolated into src/url() and this is the gate.
function safeUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (!/^(https?:\/\/|file:\/\/|\/|\.\.?\/)/i.test(value)) return '';
    return esc(value).replace(/'/g, '%27');
}

function iconSvg(name) {
    const paths = OG_ICONS[name];
    if (!paths) return '';
    const body = paths.map(d => `<path fill="currentColor" d="${d}"/>`).join('');
    return `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
}

function row(icon, value) {
    if (!value) return '';
    return `<div class="row">${iconSvg(icon)}<span>${esc(value)}</span></div>`;
}

/**
 * The share image, as a complete standalone document.
 *
 * data: {
 *   title, city, when, venue, cover,   // strings; anything falsy is dropped
 *   flyerUrl, faviconUrl, logoUrl,     // URLs (http(s), file: or relative)
 *   colors                             // a data/event-colors record, or null
 * }
 *
 * Every image is optional and self-healing: each carries an onerror that
 * removes it (the flyer's also drops the two-column layout), so a dead CDN
 * degrades to the text-only card instead of a broken-image glyph.
 */
function buildOgCardHtml(data) {
    const d = data || {};
    const aurora = deriveAuroraColors(d.colors) || AURORA_FALLBACK;
    const flyer = safeUrl(d.flyerUrl);
    const favicon = safeUrl(d.faviconUrl);
    const logo = safeUrl(d.logoUrl);
    const plate = parseHexColor((d.colors && d.colors.faviconPlate) || '') ? d.colors.faviconPlate : '#ffffff';

    // Long names step DOWN rather than clipping at three lines: "NEW DATE:
    // Bearracuda Atlanta❄️Winter Beef Ball" is a real title, and an ellipsis
    // in a share image is a worse answer than smaller type.
    const titleLength = String(d.title || '').length;
    const titleClass = titleLength > 46 ? 'title t-xs' : (titleLength > 28 ? 'title t-sm' : 'title');

    const faviconTile = favicon
        ? `<span class="fav" style="background:${esc(plate)}"><img src="${favicon}" alt="" onerror="this.parentNode.remove()"></span>`
        : '';
    const tea = String(d.tea || '').trim();
    const brandMark = `<div class="brand">${logo ? `<img src="${logo}" alt="" onerror="this.remove()">` : ''}<span>chunky.dad${d.city ? ' · ' + esc(d.city) : ''}</span></div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<title>${esc(d.title)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    /* the aurora, exactly as the card builds it: three radial stops from the
       event's own artwork over the card ground */
    background:
      radial-gradient(115% 150% at 6% 0%, ${aurora.c1} 0%, transparent 58%),
      radial-gradient(125% 160% at 97% 12%, ${aurora.c2} 0%, transparent 62%),
      radial-gradient(120% 150% at 55% 108%, ${aurora.c3} 0%, transparent 62%),
      #171a33;
    color: #fff;
    font-family: 'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex;
    align-items: center;
    gap: 40px;
    padding: 44px;
  }

  /* the flyer, whole and uncropped — the card never crops artwork either */
  .art {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 560px;
    height: 542px;
  }
  .art img {
    max-width: 560px;
    max-height: 542px;
    width: auto;
    height: auto;
    border-radius: 18px;
    box-shadow: 0 18px 50px rgba(6, 8, 20, 0.55);
  }

  /* the frosted panel that carries every piece of information */
  .panel {
    flex: 1 1 auto;
    min-width: 440px;
    align-self: stretch;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 26px;
    padding: 44px 48px;
    background: rgba(255, 255, 255, 0.13);
    -webkit-backdrop-filter: blur(18px) saturate(1.3);
    backdrop-filter: blur(18px) saturate(1.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 24px;
  }
  /* no flyer: the panel IS the card, centred, with room for a bigger title */
  body.no-art { justify-content: center; }
  body.no-art .art { display: none; }
  /* hugs its content instead of ruling a fixed 900px box with air in it */
  body.no-art .panel { flex: 0 1 auto; max-width: 940px; align-self: center; }
  body.no-art .title { font-size: 72px; }
  body.no-art .title.t-sm { font-size: 62px; }
  body.no-art .title.t-xs { font-size: 50px; }

  .titlerow { display: flex; align-items: center; gap: 20px; }
  .fav {
    flex: 0 0 72px;
    width: 72px;
    height: 72px;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.22), 0 3px 14px rgba(6, 8, 20, 0.35);
  }
  .fav img { display: block; width: 100%; height: 100%; object-fit: contain; padding: 8px; }

  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 54px;
    font-weight: 700;
    line-height: 1.08;
    letter-spacing: -1px;
    /* long names shorten rather than shove the rows off the artboard */
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .title.t-sm { font-size: 46px; letter-spacing: -0.8px; }
  /* the smallest step earns a fourth line — at 39px it fits, and a promoter's
     full event name beats an ellipsis in a share image */
  .title.t-xs { font-size: 39px; letter-spacing: -0.5px; -webkit-line-clamp: 4; }

  .rows { display: flex; flex-direction: column; gap: 14px; }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 27px;
    line-height: 1.3;
    color: rgba(255, 255, 255, 0.95);
  }
  .row:first-child { font-weight: 600; }
  .row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ico { flex: 0 0 26px; width: 26px; height: 26px; opacity: 0.85; }

  /* the event's own words, where the card puts them: under the rows, quiet,
     and clamped — a share image is a headline, not the whole description */
  .tea {
    margin: -6px 0 0;
    font-size: 22px;
    line-height: 1.4;
    color: rgba(255, 255, 255, 0.78);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* the brand line sits where the card pins its links row: panel bottom */
  .brand {
    margin-top: auto;
    padding-top: 26px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.3px;
    color: rgba(255, 255, 255, 0.72);
  }
  .brand img { width: 34px; height: 34px; border-radius: 9px; }
</style>
</head>
<body class="${flyer ? '' : 'no-art'}">
  ${flyer ? `<div class="art"><img src="${flyer}" alt="" onerror="document.body.classList.add('no-art')"></div>` : ''}
  <div class="panel">
    <div class="titlerow">
      ${faviconTile}
      <h1 class="${titleClass}">${esc(d.title)}</h1>
    </div>
    <div class="rows">
      ${row('clock', d.when)}
      ${row('pin', d.venue)}
      ${row('cash', d.cover)}
    </div>
    ${tea ? `<p class="tea">${esc(tea)}</p>` : ''}
    ${brandMark}
  </div>
</body>
</html>`;
}

const api = {
    buildOgCardHtml,
    deriveAuroraColors,
    parseHexColor,
    OG_TEMPLATE_VERSION,
    AURORA_FALLBACK
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.OgCard = api;
})(typeof window !== 'undefined' ? window : null);

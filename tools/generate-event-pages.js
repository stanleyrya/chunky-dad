#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve project root
const ROOT = path.resolve(__dirname, '..');

// The share-card design's version, mixed into each stub's og:image cache
// buster so a template change actually reaches the social scrapers.
const { OG_TEMPLATE_VERSION, formatEventWhen } = require('./og-card.js');
const { shouldHaveCard, cardRelPath, cityCardRelPath } = require('./og-policy.js');

// Load CITY_CONFIG from js/city-config.js (Node-compatible export exists)
let CITY_CONFIG;
try {
  const cityModule = require(path.join(ROOT, 'js', 'city-config.js'));
  CITY_CONFIG = cityModule.CITY_CONFIG || {};
} catch (e) {
  console.error('Failed to load CITY_CONFIG from js/city-config.js:', e.message);
  process.exit(1);
}

// Simple logger shim for Node environment to satisfy references. Installed
// BEFORE the modules below, which reference it while loading.
global.logger = {
  debug() {}, info() {}, warn() {}, error() {}, componentInit() {}, componentLoad() {}, componentError() {}, time() {}, timeEnd() {}, apiCall() {}, performance() {}
};

// Load CalendarCore for ICS parsing (Node-compatible after DOM guard).
//
// EventSchema MUST be a global before calendar-core is required: its notes
// parser reads globalThis.EventSchema, and without it every calendar silently
// yields ZERO events. That is not a harmless no-op — this script treats "no
// events" as "every stub is stale" and DELETES them, so running it plainly
// removed all 83 committed event pages (reproduced 2026-07-30; the CI step in
// .github/workflows/update-calendar-data.yml invokes it exactly this way).
// Requiring event-schema.js sets the global as a side effect, mirroring
// tools/extract-favicon-colors.js.
let CalendarCore;
try {
  require(path.join(ROOT, 'js', 'event-schema.js'));
  CalendarCore = require(path.join(ROOT, 'js', 'calendar-core.js'));
} catch (e) {
  console.error('Failed to load CalendarCore:', e.message);
  process.exit(1);
}
if (typeof globalThis.EventSchema === 'undefined') {
  console.error('EventSchema global missing after loading js/event-schema.js — refusing to run, since parsing would yield zero events and delete every event page.');
  process.exit(1);
}

// Config
const OUTPUT_DAYS_WINDOW = parseInt(process.env.EVENT_STUB_DAYS || '180', 10); // Upcoming days to generate
const PAST_DAYS_WINDOW = parseInt(process.env.EVENT_STUB_PAST_DAYS || '2', 10); // Past-days tolerance
const BUILD_ALL = /^(1|true|yes)$/i.test(process.env.EVENT_STUB_BUILD_ALL || ''); // Build all events regardless of date
const MARKER = '<!-- generated: chunky.dad event page -->';
const SITE_BASE = 'https://chunky.dad';
// When an event is too old to deserve its own card, its stub shares the city's
// card instead. Nothing 404s and the page keeps a proper 1200x630 preview.
const cityFallbackImage = (cityKey) => `${SITE_BASE}${cityCardRelPath(cityKey)}`;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === content) return false;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return true;
}

function sanitize(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// sanitize() does not touch quotes, which is fine for element text and NOT
// fine for an attribute. Descriptions are free text from the source calendar
// and do contain them, so anything going into content="..." goes through this.
function attr(text) {
  return sanitize(text).replace(/"/g, '&quot;');
}

// Source formatting, removed. The scraper sanitizes what it writes (#1575) but
// events already in the calendar keep whatever their source published —
// literal "<p>…</p>" from Wix pages, markdown "**bold**" from dice.fm — and a
// meta description is not the place for either. This is the short form of
// js/dynamic-calendar-loader.js's sanitizeDisplayText.
function plainText(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  out = out.replace(/\\r\\n|\\n/g, ' ').replace(/\\r/g, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<\/?[a-z][^<>]*\/?>/gi, ' ');
  out = out.replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ')
           .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
           .replace(/&quot;/gi, '"').replace(/&(?:#39|#039|apos);/gi, "'");
  out = out.replace(/\[([^\[\]\n]*)\]\([^()\n]*\)/g, '$1');
  out = out.replace(/\*{2,}|_{2,}/g, '');
  out = out.replace(/\\([*_#\[\].])/g, '$1');
  out = out.replace(/\\{2,}/g, '').replace(/\\+(?=\s|$)/g, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

// Cut to a word boundary rather than mid-word, and only add the ellipsis when
// something was actually removed.
function clampWords(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:—-]+$/, '') + '…';
}

function getIcsPath(cityKey) {
  return path.join(ROOT, 'data', 'calendars', `${cityKey}.ics`);
}

function withinWindow(date, now, days) {
  if (!date) return false;
  const diffMs = date.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= -PAST_DAYS_WINDOW && diffDays <= days; // configurable negative tolerance for recent past
}

// Check if an event should get a stub within the window. For recurring events,
// include if any occurrence happens within the window.
function occursInWindow(calendar, event, now, days) {
  if (withinWindow(event.startDate, now, days)) return true;
  if (event.recurring && event.recurrence) {
    try {
      const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      return calendar.isRecurringEventInPeriod(event, now, end);
    } catch (_) {
      return false;
    }
  }
  return false;
}

function buildEventHtml(cityKey, cityName, event, ctx) {
  const title = `${sanitize(event.name)} – ${cityName} – chunky.dad`;
  // og:title drops the " – chunky.dad" suffix: og:site_name now carries the
  // brand, and Discord prints it directly above the title, so keeping it in
  // both said "chunky.dad" twice. The <title> element keeps the full string —
  // that one is a browser tab and a search result, where there is no
  // site_name to lean on.
  const ogTitle = `${sanitize(event.name)} – ${cityName}`;
  const calendar = ctx && ctx.calendar;
  // One when-line for the whole stub. The share text used to be built here
  // separately — "Saturday · 10PM-4AM" while the image said "1st Sat ·
  // 10PM-4AM ET" — so a share showed two different answers at once.
  const whenText = formatEventWhen({
    start: calendar ? calendar.getLogicalStartDate(event) : (event.startDate ? new Date(event.startDate) : null),
    end: calendar ? calendar.getLogicalEndDate(event) : (event.endDate ? new Date(event.endDate) : null),
    multiDay: calendar ? calendar.isMultiDay(event) : false,
    day: event.day,
    time: event.time,
    recurring: event.recurring,
    // the site's own words for the cadence ("1st Sat", "Weekly")
    recurrenceText: calendar ? calendar.getRecurringBadgeContent(event) : '',
    timeZoneLabel: calendar ? calendar.getTimeZoneLabel(event, ctx && ctx.timeZone) : ''
  });
  const descriptionParts = [whenText];
  if (event.bar) descriptionParts.push(`@ ${event.bar}`);
  const facts = descriptionParts.filter(Boolean).join(' · ');

  // The facts, then the event's own words if there is room.
  //
  // "Thursdays · 7PM-10PM ET · @ Animal" is 34 characters and answers when and
  // where, which is what a preview is for — but 243 of the 245 events carry a
  // real description too, and it was going unused. Appending it lands the tag
  // in the 80-125 characters that link previews actually show, with content
  // rather than padding. The facts stay FIRST: they are the part that must
  // survive a client truncating the tail.
  const DESCRIPTION_BUDGET = 125;
  const tea = plainText(event.tea || event.unprocessedDescription || '');
  const room = DESCRIPTION_BUDGET - facts.length - 3; // the " — " joiner
  const description = attr(
    (tea && room >= 30 ? `${facts} — ${clampWords(tea, room)}` : facts)
  ) || `${cityName} bear event`;
  const url = `${SITE_BASE}/${cityKey}/${encodeURIComponent(event.slug)}/`;
  // The flyer the OG card should paint: the event's OWN artwork first.
  //
  // This used to ask for the LANDSCAPE candidate, because the artboard is
  // 1200×630 and a wide picture fills it. That preference cost more than it
  // bought: an `imageHorizontal` is very often a platform's banner crop
  // rather than a picture in its own right. BEEFMINCE Brief Encounter carried
  // a 2026 1080×1080 poster in `image` and, in `imageHorizontal`, a 2024
  // attachment cropped to 768×461 and upscaled to 1300×630 — the title cut
  // off top and bottom, grey bars down the sides. The card was choosing shape
  // over content and showing the wrong year's artwork.
  //
  // Shape no longer needs to decide: the card shows any aspect whole (never
  // cropped), and wide artwork can take the top of the card instead of a side
  // column. So the primary leads, and the orientation slots are what they
  // always were — alternates, for when there is no primary.
  //
  // NOTE: js/dynamic-calendar-loader.js still asks getFlyerCandidates for
  // 'landscape' on the site's cards, and has a crop rule that only catches an
  // alternate built from the SAME asset — which this is not. The site card
  // therefore still shows the bad crop for these five events.
  const flyerUrl = String(event.image || event.imageHorizontal || event.imageVertical || '').trim();

  // What the share card paints, handed over as data instead of left for
  // tools/generate-og-images.js to reverse-engineer out of og:description by
  // splitting on ' · ' and ' • '. It has the real event object right here;
  // the OG step runs later in the same workflow and reads these back.

  const cardMeta = (name, value) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return `\n  <meta name="chunky:${name}" content="${sanitize(text).replace(/"/g, '&quot;')}">`;
  };
  const flyerMeta = (/^https?:\/\//i.test(flyerUrl) ? cardMeta('flyer', flyerUrl) : '')
    + cardMeta('name', event.name)
    + cardMeta('when', whenText)
    + cardMeta('venue', event.bar)
    // 'free'/'no cover' is not information worth a row — the card drops it too
    + cardMeta('cover', /^(free|no cover)$/i.test(String(event.cover || '').trim()) ? '' : event.cover)
    + cardMeta('website', event.favicon || event.website)
    // where it is: the corner map option draws the same city map the page
    // does, with this one event pinned on it
    + cardMeta('lat', Number.isFinite(Number(event.coordinates?.lat)) ? event.coordinates.lat : '')
    + cardMeta('lng', Number.isFinite(Number(event.coordinates?.lng)) ? event.coordinates.lng : '');
  // Prefer generated per-event OG image and add a content-hash version for cache busting
  const generatedCard = cardRelPath(cityKey, event.slug);
  // Whether this event still earns a card of its own. Written into the stub so
  // tools/generate-og-images.js can simply render what the stubs ask for
  // instead of re-deriving the same date rule and eventually disagreeing.
  const wantsCard = shouldHaveCard(
    event,
    calendar ? calendar.getLogicalEndDate(event) : (event.endDate ? new Date(event.endDate) : null)
  );
  let version = '';
  try {
    const seed = JSON.stringify({
      name: event.name || '',
      // the line the card actually paints, not just its ingredients: a change
      // to how when-lines are formatted has to reach the social scrapers too
      when: whenText,
      day: event.day || '',
      time: event.time || '',
      bar: event.bar || '',
      cover: event.cover || '',
      description: event.tea || event.unprocessedDescription || '',
      // The generated OG card paints the flyer when there is one, so a flyer
      // change has to bust the cache too — before this, swapping an event's
      // image left every share preview showing the old artwork.
      flyer: flyerUrl,
      // …and so does a redesign of the card itself. The PNG is regenerated at
      // the same path, so without this every scraper that cached the old
      // artboard keeps serving it (Facebook and iMessage cache aggressively).
      template: OG_TEMPLATE_VERSION
    });
    version = crypto.createHash('md5').update(seed).digest('hex').slice(0, 8);
  } catch (e) {
    version = '';
  }
  const generatedUrl = `${SITE_BASE}${generatedCard}${version ? `?v=${version}` : ''}`;
  const ogImage = wantsCard ? generatedUrl : cityFallbackImage(cityKey);

  // Self-referential. It used to name the CITY page, which tells every
  // crawler "the real page is /nyc/" — so a share of an event previewed as
  // the city. Combined with the head meta-refresh below that was two separate
  // instructions to go and read the wrong og:image.
  const canonical = `/${cityKey}/${encodeURIComponent(event.slug)}/`;
  // Build a date parameter from event.startDate in YYYY-MM-DD for deep-link.
  //
  // A RECURRING event must not carry one. Its startDate is the SERIES start,
  // so baking it in sent every share link to the week the series began —
  // Chicago's Bear Happy Hour was landing visitors on 2025-07-10, fourteen
  // months in the past, and every one of the 14 recurring stubs did the same.
  // With no date the site opens on today and updateCalendarDisplay's
  // re-binding pass selects the nearest real occurrence, which is what a
  // dateless card ("Thursdays · 5PM-9PM CT") promises. A caller who wants one
  // specific occurrence still says so with ?eventDate=, and the redirect
  // below copies incoming params over these defaults.
  let dateParam = '';
  try {
    const d = event.recurring
      ? null
      : (event.startDate instanceof Date ? event.startDate : (event.startDate ? new Date(event.startDate) : null));
    if (d && !isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dateParam = `${y}-${m}-${dd}`;
    }
  } catch (e) {
    dateParam = '';
  }
  const redirectTarget = dateParam
    ? `../?event=${encodeURIComponent(event.slug)}&date=${encodeURIComponent(dateParam)}&view=week`
    : `../?event=${encodeURIComponent(event.slug)}&view=week`;

  return `<!DOCTYPE html>
${MARKER}
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <!-- Discord and friends print this above the title; without it the card is
       anonymous. Kept as the bare domain, which is how the brand reads. -->
  <meta property="og:site_name" content="chunky.dad">
  <meta property="og:title" content="${attr(ogTitle)}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ogImage}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${attr(ogTitle)}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${ogImage}">${flyerMeta}
  <!-- Inline and tiny: this page is a redirect for almost everyone, so it must
       not pull a stylesheet. It only ever renders for a visitor without JS. -->
  <style>
    body { margin: 0; background: #10131f; color: #fff;
           font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .event-stub { max-width: 34rem; margin: 0 auto; padding: 3rem 1.5rem; }
    .event-stub h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 .5rem; }
    .event-stub p { margin: 0 0 1rem; color: rgba(255,255,255,.8); }
    .event-stub a { color: #9db2ff; }
  </style>
</head>
<body>
  <!-- The redirect is JavaScript-ONLY, deliberately, and this page has real
       content instead of a second redirect.

       There used to be a <meta http-equiv="refresh"> in the <head> AND one in
       a <noscript> here. Link-preview crawlers follow both — they run no JS,
       which is exactly the condition the <noscript> is written for — so
       iMessage fetched this page, was sent on to /<city>/, and previewed the
       CITY card instead of this event's. Testers that do not follow
       meta-refresh showed the right card, which is the split the owner saw.

       So: a visitor with JS is redirected by the script below, instantly. A
       visitor without JS, and any crawler, gets this page as it stands — the
       og: tags in the head, and the link underneath to follow by hand. -->
  <main class="event-stub">
    <h1>${title}</h1>
    <p>${description}</p>
    <p><a href="${redirectTarget}">Open in the ${sanitize(cityName)} guide &rarr;</a></p>
  </main>
  <script>
    (function(){
      try {
        var hash = window.location.hash || '';
        // Prefer incoming params (date/view) when provided; always enforce event param
        var target = new URL(${JSON.stringify(redirectTarget)}, window.location.href);
        var incoming = new URL(window.location.href);
        // Copy ALL incoming params over target (override)
        incoming.searchParams.forEach(function(v, k){
          target.searchParams.set(k, v);
        });
        // Ensure event param matches this page's event slug
        target.searchParams.set('event', ${JSON.stringify(event.slug)});
        var finalUrl = target.pathname + '?' + target.searchParams.toString() + hash;
        location.replace(finalUrl);
      } catch (e) {
        location.replace(${JSON.stringify(redirectTarget)});
      }
    })();
  </script>
</body>
</html>`;
}

function pruneOldEventDirs(cityKey, validSlugs) {
  const cityDir = path.join(ROOT, cityKey);
  if (!fs.existsSync(cityDir)) return 0;
  // Fail closed on a wholesale wipe. "This city parsed zero events" is far more
  // often a loading/parsing failure than a genuinely empty calendar — that is
  // exactly how a missing EventSchema global deleted all 83 committed event
  // pages — and deleting a city's entire published history is not something a
  // generator should ever do silently. A city that really has no events keeps
  // its stale pages until someone removes them deliberately.
  if (validSlugs.size === 0) {
    const generatedCount = fs.readdirSync(cityDir, { withFileTypes: true })
      .filter(ent => ent.isDirectory())
      .filter(ent => {
        const indexFile = path.join(cityDir, ent.name, 'index.html');
        return fs.existsSync(indexFile)
          && fs.readFileSync(indexFile, 'utf8').includes('generated: chunky.dad event page');
      }).length;
    if (generatedCount > 0) {
      console.warn(`⚠️  ${cityKey}: parsed 0 events but ${generatedCount} generated page(s) exist — refusing to prune (looks like a parse failure, not an empty calendar)`);
      return 0;
    }
  }
  let removed = 0;
  const entries = fs.readdirSync(cityDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const slugDir = path.join(cityDir, ent.name);
    const indexFile = path.join(slugDir, 'index.html');
    if (fs.existsSync(indexFile)) {
      const html = fs.readFileSync(indexFile, 'utf8');
      if (html.includes('generated: chunky.dad event page') && !validSlugs.has(ent.name)) {
        fs.rmSync(slugDir, { recursive: true, force: true });
        removed++;
      }
    }
  }
  return removed;
}

async function main() {
  let totalChanges = 0;
  const now = new Date();
  const calendar = new CalendarCore();

  const visibleCities = Object.entries(CITY_CONFIG).filter(([, cfg]) => cfg && cfg.visible !== false);
  for (const [cityKey, cfg] of visibleCities) {
    const icsPath = getIcsPath(cityKey);
    if (!fs.existsSync(icsPath)) {
      console.log(`⏭️  No ICS for ${cityKey}, skipping event pages`);
      continue;
    }

    const icalText = fs.readFileSync(icsPath, 'utf8');
    // Set process timezone to calendar TZID before parsing, so Node Date uses the intended zone
    try {
      const tzMatch = icalText.match(/X-WR-TIMEZONE:(.+)/);
      if (tzMatch && tzMatch[1]) {
        // This influences Node's Date parsing in this process only
        process.env.TZ = tzMatch[1].trim();
      }
    } catch (_) {}
    const events = calendar.parseICalData(icalText) || [];
    const upcoming = BUILD_ALL ? events : events.filter(ev => occursInWindow(calendar, ev, now, OUTPUT_DAYS_WINDOW));
    if (BUILD_ALL) {
      console.log(`🧱 BUILD_ALL enabled for ${cityKey}: generating ${upcoming.length}/${events.length} events`);
    }

    // Map by slug to guarantee unique stubs
    const uniqueBySlug = new Map();
    for (const ev of upcoming) {
      if (!ev.slug) continue;
      if (!uniqueBySlug.has(ev.slug)) uniqueBySlug.set(ev.slug, ev);
    }

    const validSlugs = new Set(uniqueBySlug.keys());
    let cityChanges = 0;

    // Write stubs
    for (const [slug, ev] of uniqueBySlug.entries()) {
      const outFile = path.join(ROOT, cityKey, slug, 'index.html');
      const html = buildEventHtml(cityKey, cfg.name || cityKey, ev, { calendar, timeZone: cfg.timezone });
      if (writeIfChanged(outFile, html)) {
        cityChanges++;
        console.log(`✓ Wrote ${path.relative(ROOT, outFile)}`);
      } else {
        console.log(`⏭️  No change for ${path.relative(ROOT, outFile)}`);
      }
    }

    // Prune removed events for this city (only our generated ones)
    const removed = pruneOldEventDirs(cityKey, validSlugs);
    if (removed > 0) cityChanges += removed;

    if (cityChanges > 0) totalChanges += cityChanges;
  }

  if (totalChanges === 0) {
    console.log('No event pages changed.');
  } else {
    console.log(`Event page generation complete. ${totalChanges} change(s).`);
  }
}

main().catch(err => {
  console.error('Fatal error generating event pages:', err);
  process.exit(1);
});


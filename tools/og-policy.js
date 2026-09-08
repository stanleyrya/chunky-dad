#!/usr/bin/env node

/**
 * Shared rules for the generated share cards.
 *
 * tools/generate-event-pages.js decides which events deserve a card and writes
 * that decision INTO the stub (its og:image either points at the card or falls
 * back to the city card). tools/generate-og-images.js then reads the stubs back
 * and renders exactly what they ask for. Keeping the decision in one place is
 * deliberate: the two tools run in the same workflow but minutes apart, and any
 * rule duplicated between them would eventually disagree and leave stubs
 * pointing at images nobody generates.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// JPEG, not PNG. These cards are photographic — a flyer over a gradient — and
// PNG was costing ~273 KB apiece where JPEG costs a fraction of that. Not WebP:
// Facebook's crawler is still unreliable on WebP for og:image, and a share
// preview that silently fails to render is worse than a slightly larger file.
const CARD_EXT = '.jpg';
const CARD_DIR = path.join(ROOT, 'img', 'og');

// How long a finished event keeps its own card. Past events keep their PAGE
// forever — old shared links must not 404 — but a card for a party that
// happened last spring is 100 KB earning nothing, so it expires and the stub
// falls back to the city card.
const CARD_GRACE_DAYS = 30;

function startOfDay(d) {
  const copy = new Date(d.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * Does this event get its own card?
 *
 * Recurring events always do: they have no date on the card, so one image
 * serves every occurrence forever. One-off events do while they are upcoming
 * and for CARD_GRACE_DAYS afterwards, so a link shared the morning after still
 * previews properly.
 */
function shouldHaveCard(event, endDate, now = new Date()) {
  if (!event) return false;
  if (event.recurring) return true;

  const end = endDate instanceof Date && !isNaN(endDate.getTime())
    ? endDate
    : (event.startDate ? new Date(event.startDate) : null);
  if (!end || isNaN(end.getTime())) return true; // undated: keep, we cannot prove it is over

  const cutoff = startOfDay(now);
  cutoff.setDate(cutoff.getDate() - CARD_GRACE_DAYS);
  return end >= cutoff;
}

function cardRelPath(cityKey, slug) {
  return `/img/og/${cityKey}/${encodeURIComponent(slug)}${CARD_EXT}`;
}

function cityCardRelPath(cityKey) {
  return `/img/og/city/${cityKey}${CARD_EXT}`;
}

function homeCardRelPath() {
  return `/img/og/home${CARD_EXT}`;
}

/**
 * Map a remote flyer URL to the copy tools/download-images.js already put on
 * disk.
 *
 * This matters more than it looks. The card used to paint the REMOTE url, so
 * every render re-fetched the original artwork — often enormous (one flyer is
 * 3300x5100) for a box that is at most 520px wide. That made the render
 * non-deterministic, which defeated the byte-comparison write gate and churned
 * one card through 424 rewrites; it was also slow, and the documented cause of
 * a CI job abort when a host hung.
 *
 * The .meta sidecars record the exact originalUrl, so the mapping is looked up
 * rather than recomputed. Files without a sidecar fall back to the URL hash
 * that download-images.js embeds in every filename (`_<hash>.<ext>`).
 */
function buildFlyerIndex(eventsDir = path.join(ROOT, 'img', 'events')) {
  const byUrl = new Map();
  const byHash = new Map();
  if (!fs.existsSync(eventsDir)) return { byUrl, byHash };

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith('.meta')) {
        try {
          const meta = JSON.parse(fs.readFileSync(full, 'utf8'));
          const image = full.slice(0, -'.meta'.length);
          if (!fs.existsSync(image)) continue;
          for (const key of [meta.originalUrl, meta.adjustedUrl]) {
            if (key) byUrl.set(String(key), image);
          }
        } catch (e) { /* a torn sidecar just means we fall back to the hash */ }
        continue;
      }
      // thumbnails are for the mobile rail, never for a 1200x630 card
      if (entry.name.includes('-thumb.')) continue;
      const m = entry.name.match(/_([0-9a-f]{8})\.[a-z0-9]+$/i);
      if (m && !byHash.has(m[1])) byHash.set(m[1], full);
    }
  };
  walk(eventsDir);
  return { byUrl, byHash };
}

function localFlyerFor(flyerUrl, index, simpleHash) {
  if (!flyerUrl || !index) return '';
  const direct = index.byUrl.get(String(flyerUrl));
  if (direct) return direct;
  if (typeof simpleHash === 'function') {
    const hit = index.byHash.get(simpleHash(String(flyerUrl)));
    if (hit) return hit;
  }
  return '';
}

module.exports = {
  CARD_EXT,
  CARD_DIR,
  CARD_GRACE_DAYS,
  shouldHaveCard,
  cardRelPath,
  cityCardRelPath,
  homeCardRelPath,
  buildFlyerIndex,
  localFlyerFor
};

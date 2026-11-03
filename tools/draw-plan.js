#!/usr/bin/env node
// Draw a floor plan to scale from a room list, for the fit check tool. Listing plans are often
// not to scale with their own labels; this draws every room as a box of its labelled size, in
// the listing's arrangement, so furniture drawn to scale means something in every room.
//
//   node tools/draw-plan.js testing/plans/<name>.plan.json
//
// The JSON: { ppi, wall, margin, rooms:[{label?, dims?, x, y, w, h, dashed?}], fixtures:[{label, x, y, w, h}],
// doors:[{x, y, w, h}] (white gaps cut through walls), labels:[{text, x, y, anchor?}], notes? } — every x/y/w/h in inches from the top-left, rooms are interiors.
// Writes <name>.png next to the JSON and prints the img:{w,h} + ppi line for BUILT_IN.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const specPath = process.argv[2];
if (!specPath) { console.error('usage: node tools/draw-plan.js <plan.json>'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const ppi = spec.ppi || 4, wall = spec.wall || 6, margin = spec.margin || 12;
const rooms = spec.rooms || [], fixtures = spec.fixtures || [], doors = spec.doors || [];
const minX = Math.min(...rooms.map(r => r.x)) - wall, minY = Math.min(...rooms.map(r => r.y)) - wall;
const maxX = Math.max(...rooms.map(r => r.x + r.w)) + wall, maxY = Math.max(...rooms.map(r => r.y + r.h)) + wall;
const W = Math.round((maxX + margin) * ppi), H = Math.round((maxY + margin + (spec.notes ? 14 : 0)) * ppi);
const P = (v) => (v * ppi).toFixed(1);
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const parts = [];
parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
// Every room wears a wall ring; the interiors are cut out afterwards, so a wall survives only where
// no room covers it. Dashed rooms are open to their neighbours (an outline, no wall of their own).
for (const r of rooms) {
  if (r.dashed) continue;
  parts.push(`<rect x="${P(r.x - wall)}" y="${P(r.y - wall)}" width="${P(r.w + wall * 2)}" height="${P(r.h + wall * 2)}" fill="#3a3a3a"/>`);
}
for (const r of rooms) {
  if (r.dashed) continue;
  parts.push(`<rect x="${P(r.x)}" y="${P(r.y)}" width="${P(r.w)}" height="${P(r.h)}" fill="#fff"/>`);
}
for (const d of doors) parts.push(`<rect x="${P(d.x)}" y="${P(d.y)}" width="${P(d.w)}" height="${P(d.h)}" fill="#fff"/>`);
for (const r of rooms) {
  if (r.dashed) parts.push(`<rect x="${P(r.x)}" y="${P(r.y)}" width="${P(r.w)}" height="${P(r.h)}" fill="none" stroke="#9a9a9a" stroke-width="${ppi}" stroke-dasharray="${ppi * 4} ${ppi * 3}"/>`);
  if (!r.label) continue;
  const cx = P(r.x + r.w / 2), cy = (r.y + r.h / 2) * ppi;
  parts.push(`<text x="${cx}" y="${(cy - (r.dims ? 3 : 0) * ppi).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${ppi * 7}" fill="#222">${esc(r.label)}</text>`);
  if (r.dims) parts.push(`<text x="${cx}" y="${(cy + 6 * ppi).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${ppi * 6}" fill="#222">${esc(r.dims)}</text>`);
}
for (const f of fixtures) {
  parts.push(`<rect x="${P(f.x)}" y="${P(f.y)}" width="${P(f.w)}" height="${P(f.h)}" fill="#e6e6e6" stroke="#777" stroke-width="${ppi * 0.5}"/>`);
  if (f.label) parts.push(`<text x="${P(f.x + f.w / 2)}" y="${((f.y + f.h / 2) * ppi + ppi * 1.6).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${ppi * Math.min(4.5, Math.max(2.5, f.w / 8))}" fill="#333">${esc(f.label)}</text>`);
}
for (const l of spec.labels || []) parts.push(`<text x="${P(l.x)}" y="${P(l.y)}" text-anchor="${l.anchor || 'start'}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${ppi * 5}" fill="#222">${esc(l.text)}</text>`);
if (spec.notes) parts.push(`<text x="${P(minX)}" y="${P(maxY + margin + 8)}" font-family="Helvetica, Arial, sans-serif" font-size="${ppi * 4.5}" fill="#555">${esc(spec.notes)}</text>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
const out = specPath.replace(/\.plan\.json$/, '') + '.png';
sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(out).then(info => {
  console.log(`${out}: ${info.width}×${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
  console.log(`img:{ src:'plans/${path.basename(out)}', w:${info.width}, h:${info.height} }, ppi:${ppi}`);
});

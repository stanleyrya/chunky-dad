#!/usr/bin/env node
// Draw a floor plan to scale from a room list, for the fit check tool. Listing plans are often
// not to scale with their own labels; this draws every room as a box of its labelled size, in
// the listing's arrangement, so furniture drawn to scale means something in every room.
//
//   node tools/draw-plan.js testing/plans/<name>.plan.json
//
// The JSON: { ppi, wall, margin, rooms:[{label?, dims?, x, y, w, h, dashed?}], fixtures:[{label, x, y, w, h}],
// doors:[{x, y, w, h}] (white gaps cut through walls), labels:[{text, x, y, anchor?, size?, fill?, weight?, rotate?}], notes? } — every x/y/w/h in inches from the top-left, rooms are interiors.
// A room or fixture that is not a box gives its corners instead: poly:[[x,y],…] (a slanted window wall, a post cut by one), with labelAt:[x,y] for its label.
// Writes <name>.png next to the JSON and prints the img:{w,h} + ppi line for BUILT_IN.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const specPath = process.argv[2];
if (!specPath) { console.error('usage: node tools/draw-plan.js <plan.json>'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const ppi = spec.ppi || 4, wall = spec.wall || 6, margin = spec.margin || 12;
const rooms = spec.rooms || [], fixtures = spec.fixtures || [], doors = spec.doors || [];
const corners = (r) => r.poly || [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
const allX = rooms.flatMap(r => corners(r).map(c => c[0])), allY = rooms.flatMap(r => corners(r).map(c => c[1]));
const minX = Math.min(...allX) - wall, minY = Math.min(...allY) - wall;
const maxX = Math.max(...allX) + wall, maxY = Math.max(...allY) + wall;
const W = Math.round((maxX + margin) * ppi), H = Math.round((maxY + margin + (spec.notes ? 14 : 0)) * ppi);
const P = (v) => (v * ppi).toFixed(1);
const points = (r) => corners(r).map(c => `${P(c[0])},${P(c[1])}`).join(' ');
// Where a shape's label sits: labelAt, or the middle of its corners.
const middle = (r) => r.labelAt || [corners(r).reduce((sum, c) => sum + c[0], 0) / corners(r).length, corners(r).reduce((sum, c) => sum + c[1], 0) / corners(r).length];
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const parts = [];
parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
// Every room wears a wall ring; the interiors are cut out afterwards, so a wall survives only where
// no room covers it. Dashed rooms are open to their neighbours (an outline, no wall of their own).
for (const r of rooms) {
  if (r.dashed) continue;
  if (r.poly) parts.push(`<polygon points="${points(r)}" fill="#3a3a3a" stroke="#3a3a3a" stroke-width="${P(wall * 2)}" stroke-linejoin="miter" stroke-miterlimit="8"/>`);
  else parts.push(`<rect x="${P(r.x - wall)}" y="${P(r.y - wall)}" width="${P(r.w + wall * 2)}" height="${P(r.h + wall * 2)}" fill="#3a3a3a"/>`);
}
for (const r of rooms) {
  if (r.dashed) continue;
  if (r.poly) parts.push(`<polygon points="${points(r)}" fill="#fff"/>`);
  else parts.push(`<rect x="${P(r.x)}" y="${P(r.y)}" width="${P(r.w)}" height="${P(r.h)}" fill="#fff"/>`);
}
for (const d of doors) parts.push(`<rect x="${P(d.x)}" y="${P(d.y)}" width="${P(d.w)}" height="${P(d.h)}" fill="#fff"/>`);
for (const r of rooms) {
  if (r.dashed) parts.push(`<rect x="${P(r.x)}" y="${P(r.y)}" width="${P(r.w)}" height="${P(r.h)}" fill="none" stroke="#9a9a9a" stroke-width="${ppi}" stroke-dasharray="${ppi * 4} ${ppi * 3}"/>`);
  if (!r.label) continue;
  const cx = P(middle(r)[0]), cy = middle(r)[1] * ppi;
  parts.push(`<text x="${cx}" y="${(cy - (r.dims ? 3 : 0) * ppi).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${ppi * 7}" fill="#222">${esc(r.label)}</text>`);
  if (r.dims) parts.push(`<text x="${cx}" y="${(cy + 6 * ppi).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${ppi * 6}" fill="#222">${esc(r.dims)}</text>`);
}
for (const f of fixtures) {
  const wide = f.poly ? Math.max(...f.poly.map(c => c[0])) - Math.min(...f.poly.map(c => c[0])) : f.w;
  if (f.poly) parts.push(`<polygon points="${points(f)}" fill="${f.fill || '#e6e6e6'}" stroke="#777" stroke-width="${ppi * 0.5}"/>`);
  else parts.push(`<rect x="${P(f.x)}" y="${P(f.y)}" width="${P(f.w)}" height="${P(f.h)}" fill="${f.fill || '#e6e6e6'}" stroke="#777" stroke-width="${ppi * 0.5}"/>`);
  if (f.label) parts.push(`<text x="${P(middle(f)[0])}" y="${(middle(f)[1] * ppi + ppi * 1.6).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${ppi * Math.min(4.5, Math.max(2.5, wide / 8))}" fill="#333">${esc(f.label)}</text>`);
}
for (const l of spec.labels || []) parts.push(`<text x="${P(l.x)}" y="${P(l.y)}" text-anchor="${l.anchor || 'start'}"${l.rotate ? ` transform="rotate(${l.rotate} ${P(l.x)} ${P(l.y)})"` : ''} font-family="Helvetica, Arial, sans-serif" font-weight="${l.weight || 'bold'}" font-size="${ppi * (l.size || 5)}" fill="${l.fill || '#222'}">${esc(l.text)}</text>`);
if (spec.notes) parts.push(`<text x="${P(minX)}" y="${P(maxY + margin + 8)}" font-family="Helvetica, Arial, sans-serif" font-size="${ppi * 4.5}" fill="#555">${esc(spec.notes)}</text>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
const out = specPath.replace(/\.plan\.json$/, '') + '.png';
sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(out).then(info => {
  console.log(`${out}: ${info.width}×${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
  console.log(`img:{ src:'plans/${path.basename(out)}', w:${info.width}, h:${info.height} }, ppi:${ppi}`);
});

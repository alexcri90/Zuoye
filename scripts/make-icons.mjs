// Draws the app icon (a vermilion seal with 作业) and writes public/icon.svg
// plus the PNG sizes that browsers and phones ask for.
// The characters are drawn from the stroke data the app already ships
// (hanzi-writer-data, Arphic Public License), so the icon looks the same on
// every device, whatever fonts it has.
// Usage: node scripts/make-icons.mjs   (needs Edge or Chrome installed)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');
const strokes = (char) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', 'hanzi-writer-data', `${char}.json`), 'utf8')).strokes;

// The seal fills the whole square, with no paper margin: phones cut the icon
// to their own shape (circle, squircle), and a light margin showed as a pale
// ring around it. The characters stay inside the central circle (80% of the
// side) that every launcher keeps.
const VERMILION = '#c8372d';
const INK_ON_SEAL = '#fff8f2';
const SIZE = 512;
const GLYPH = 140; // side of one character, in icon units
const GAP = 10;

/** One character placed with its top-left corner at (x, y). Stroke data is 1024 units wide, y pointing up. */
function glyph(char, x, y) {
  const k = GLYPH / 1024;
  const paths = strokes(char).map((d) => `<path d="${d}"/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${k} ${-k}) translate(0 -900)">${paths}</g>`;
}

const left = SIZE / 2 - GLYPH - GAP / 2;
const top = SIZE / 2 - GLYPH / 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${VERMILION}"/>
  <g fill="${INK_ON_SEAL}">${glyph('作', left, top)}${glyph('业', left + GLYPH + GAP, top)}</g>
</svg>
`;
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(path.join(pub, 'icon.svg'), svg);

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true });
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(pub, `icon-${size}.png`) });
  await page.close();
}
await browser.close();
console.log('written: public/icon.svg, icon-180.png, icon-192.png, icon-512.png');

// Drives the BUILT app (production CSP included) in a phone-sized browser,
// served from a sub-path, and saves screenshots to e2e-out/.
// Usage: npm run build && node scripts/e2e.mjs
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, process.env.E2E_DIST ?? 'dist');
const out = path.join(root, 'e2e-out');
// A sub-path by default, to prove the build does not assume the domain root; E2E_PREFIX=/ checks the root.
const PREFIX = process.env.E2E_PREFIX ?? '/sotto/cartella/';
fs.mkdirSync(out, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function serveDist() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(404).end();
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
    const file = path.join(dist, rel);
    if (!file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

const server = await serveDist();
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true });

const problems = [];
const requests = [];
const failures = [];

async function newPage(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    locale: 'it-IT',
    ...options,
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('request', (r) => requests.push(r.url()));
  page.on('requestfailed', (r) => failures.push(`${r.url()} (${r.failure()?.errorText ?? '?'})`));
  return { context, page };
}

const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const button = (page, name) => page.getByRole('button', { name, exact: true });

/** Screen coordinates of a character's stroke medians inside the writing grid. */
async function strokePaths(page, char) {
  const box = await page.locator('.tian > div').boundingBox();
  const data = await (await fetch(`${base}hanzi/${char.codePointAt(0).toString(16)}.json`)).json();
  const size = box.width;
  const padding = Math.round(size * 0.07);
  const scale = (size - 2 * padding) / 1024;
  return data.medians.map((median) =>
    median.map(([x, y]) => [box.x + padding + x * scale, box.y + size - padding - 124 * scale - y * scale]),
  );
}

async function drawPath(page, points) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(220);
}

async function writeChar(page, char) {
  await page.waitForSelector(`.tian[data-char="${char}"][data-status="ready"]`);
  for (const points of await strokePaths(page, char)) await drawPath(page, points);
}

async function scribble(page) {
  const box = await page.locator('.tian > div').boundingBox();
  const x = box.x + box.width * 0.9;
  const y = box.y + box.height * 0.92;
  await drawPath(page, [
    [x, y],
    [x - 14, y - 3],
    [x - 28, y],
  ]);
}

try {
  // ---------- first run ----------
  const { context, page } = await newPage();
  await page.goto(base);
  await page.waitForSelector('.page');
  check('app loads from a sub-path', (await page.title()).includes('Zuòyè'));
  check('CSP meta tag is present', (await page.locator('meta[http-equiv="Content-Security-Policy"]').count()) === 1);
  await shot(page, '01-home-empty');

  await page.getByRole('link', { name: /Lezioni/ }).click();
  await page.waitForSelector('text=Carica la lezione di esempio');
  await shot(page, '02-lessons-empty');
  await button(page, 'Carica la lezione di esempio').click();
  await page.waitForSelector('a.row');
  check('sample lesson is listed', (await page.locator('a.row').count()) === 1);
  await shot(page, '03-lessons');

  await page.getByRole('link', { name: /Esercizi/ }).click();
  await page.waitForSelector('button.row');
  const homeBefore = await page.locator('.list').innerText();
  await shot(page, '04-home');

  // ---------- exercise 1: pinyin ----------
  await page.locator('button.row', { hasText: 'Pinyin' }).click();
  const input = page.locator('input.pinyin-input');
  await input.waitFor();
  check('pinyin: first word shown', (await page.locator('.zh-big').innerText()) === '你好');
  await input.pressSequentially('ni3hao3');
  check('pinyin: digits become tone marks while typing', (await input.inputValue()) === 'nǐhǎo', await input.inputValue());
  await shot(page, '05-pinyin-typing');
  await button(page, 'Verifica').click();
  check('pinyin: correct answer accepted', (await page.locator('.feedback.ok .feedback-title').innerText()) === 'Giusto');
  check('pinyin: meaning shown after answering', (await page.locator('.feedback').innerText()).includes('ciao'));
  await shot(page, '06-pinyin-correct');
  await button(page, 'Avanti').click();

  await input.pressSequentially('xie4xie4'); // lesson writes a neutral tone: any tone accepted
  await button(page, 'Verifica').click();
  check('pinyin: neutral-tone leniency', (await page.locator('.feedback.ok').count()) === 1);
  await button(page, 'Avanti').click();

  await input.pressSequentially('lao3shi4');
  await button(page, 'Verifica').click();
  const toneFeedback = await page.locator('.feedback.bad').innerText();
  check('pinyin: wrong tone reported with its syllable', toneFeedback.includes('tono sbagliato') && toneFeedback.includes('sillaba 2'), toneFeedback.replace(/\n/g, ' | '));
  check('pinyin: wrong syllable highlighted', (await page.locator('.syllables .wrong').innerText()).trim() === 'shī');
  await shot(page, '07-pinyin-wrong-tone');
  await button(page, 'Avanti').click();

  await button(page, 'Non lo so').click();
  check('pinyin: giving up shows the answer', (await page.locator('.feedback.bad').innerText()).includes('xué'));
  await shot(page, '08-pinyin-gave-up');
  await button(page, 'Avanti').click();

  await input.pressSequentially('peng');
  await button(page, 'Secondo tono').click();
  await input.pressSequentially('you');
  check('pinyin: tone button marks the last syllable and keeps the focus', (await input.inputValue()) === 'péngyou', await input.inputValue());
  await shot(page, '09-pinyin-tone-buttons');
  await button(page, 'Verifica').click();
  check('pinyin: answer built with tone buttons accepted', (await page.locator('.feedback.ok').count()) === 1);
  await button(page, 'Chiudi la sessione').click();
  await page.waitForSelector('button.row');

  // ---------- exercise 2: writing ----------
  await page.locator('button.row', { hasText: 'Scrittura' }).click();
  await page.waitForSelector('.tian');
  const strokeRequests = () => requests.filter((u) => u.includes('/hanzi/'));
  await writeChar(page, '你');
  check('writing: stroke data comes from the app address', strokeRequests().length > 0 && strokeRequests().every((u) => u.startsWith(base)), strokeRequests()[0]);
  await shot(page, '10-writing-second-char');
  await writeChar(page, '好');
  await page.waitForSelector('.feedback');
  check('writing: no help gives "Ben scritto"', (await page.locator('.feedback-title').innerText()) === 'Ben scritto');
  await shot(page, '11-writing-done');
  await button(page, 'Avanti').click();

  // Outline ("Traccia") lowers the result to "hard".
  await page.waitForSelector('.tian[data-status="ready"]');
  await button(page, 'Traccia').click();
  await page.waitForTimeout(500);
  await shot(page, '12-writing-outline');
  await writeChar(page, '谢');
  await writeChar(page, '谢');
  await page.waitForSelector('.feedback');
  check('writing: outline gives "Scritto con un aiuto"', (await page.locator('.feedback-title').innerText()) === 'Scritto con un aiuto');
  await button(page, 'Avanti').click();

  // Full animation ("Mostra") means the item comes back.
  await page.waitForSelector('.tian[data-status="ready"]');
  await button(page, 'Mostra').click();
  await page.waitForSelector('.tian[data-status="showing"]');
  await page.waitForTimeout(900);
  await shot(page, '13-writing-animation');
  await page.waitForSelector('.tian[data-status="ready"]', { timeout: 30000 });
  await writeChar(page, '老');
  await writeChar(page, '师');
  await page.waitForSelector('.feedback');
  check('writing: animation gives "Da ripassare"', (await page.locator('.feedback-title').innerText()).startsWith('Da ripassare'));
  await shot(page, '14-writing-again');
  await button(page, 'Avanti').click();

  // Three misses on a stroke trigger the automatic hint.
  await page.waitForSelector('.tian[data-status="ready"]');
  for (let i = 0; i < 3; i++) await scribble(page);
  await page.waitForTimeout(400);
  await shot(page, '15-writing-hint');
  await writeChar(page, '学');
  await writeChar(page, '生');
  await page.waitForSelector('.feedback');
  check('writing: automatic hint gives "Scritto con un aiuto"', (await page.locator('.feedback-title').innerText()) === 'Scritto con un aiuto');
  await button(page, 'Chiudi la sessione').click();
  await page.waitForSelector('button.row');

  // ---------- progress survives a reload ----------
  const homeAfter = await page.locator('.list').innerText();
  check('home counts changed after practising', homeAfter !== homeBefore, homeAfter.replace(/\n/g, ' '));
  await page.reload();
  await page.waitForSelector('button.row');
  check('progress survives a reload', (await page.locator('.list').innerText()) === homeAfter);
  await shot(page, '16-home-after');

  // ---------- settings ----------
  await page.getByRole('link', { name: /Impostazioni/ }).click();
  await page.waitForSelector('.chips');
  await button(page, '5').click();
  await shot(page, '17-settings');
  await page.reload();
  await page.waitForSelector('.chips');
  check('settings survive a reload', (await button(page, '5').getAttribute('aria-pressed')) === 'true');

  // The stroke tolerance is a setting too.
  await button(page, 'Tollerante').click();
  await page.reload();
  await page.waitForSelector('.chips');
  check('stroke tolerance survives a reload', (await button(page, 'Tollerante').getAttribute('aria-pressed')) === 'true');
  await button(page, 'Normale').click();
  check('the default stroke tolerance is the middle one', (await button(page, 'Normale').getAttribute('aria-pressed')) === 'true');

  // ---------- a whole session, to the summary ----------
  await page.goto(`${base}#/practice/mista`);
  await page.waitForSelector('.exercise');
  for (let guard = 0; guard < 40 && (await page.locator('.summary').count()) === 0; guard++) {
    if ((await page.locator('.options').count()) > 0) {
      await page.locator('.option').first().click();
      await button(page, 'Avanti').click();
    } else if ((await page.locator('input.pinyin-input, textarea, .tiles').count()) > 0) {
      await button(page, 'Non lo so').click();
      await button(page, 'Avanti').click();
    } else {
      const char = await page.locator('.tian').getAttribute('data-char');
      await writeChar(page, char);
      await page.waitForFunction((c) => document.querySelector('.tian')?.getAttribute('data-char') !== c || document.querySelector('.feedback'), char);
      if ((await page.locator('.feedback').count()) > 0) await button(page, 'Avanti').click();
    }
    await page.waitForTimeout(80);
  }
  check('a session ends with a summary', (await page.locator('.summary').count()) === 1);
  await shot(page, '18-summary');

  // ---------- service worker and offline ----------
  await page.goto(base);
  const swReady = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => Boolean(r.active)));
  check('service worker is active', swReady);
  await page.reload();
  await page.waitForSelector('.page');
  await context.setOffline(true);
  await page.reload();
  const offlineOk = await page.waitForSelector('button.row', { timeout: 8000 }).then(() => true, () => false);
  check('app shell loads offline', offlineOk);
  if (offlineOk) {
    await page.goto(`${base}#/practice/write?extra=1`);
    await page.waitForSelector('.tian');
    const status = await page.waitForSelector('.tian[data-status="ready"], .tian[data-status="missing"]').then((el) => el.getAttribute('data-status'));
    check('writing works offline for characters already seen', status === 'ready', `status=${status}`);
    await shot(page, '19-offline-writing');
  }
  await context.setOffline(false);
  await context.close();

  // ---------- airplane mode: exercises 1, 2, 5 and reorder on characters never opened before ----------
  const plane = await newPage();
  await plane.page.goto(base);
  await plane.page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await plane.page.reload(); // from here on the service worker controls the page
  await plane.page.goto(`${base}#/lessons`);
  await button(plane.page, 'Carica la lezione di esempio').click();
  await plane.page.waitForSelector('a.row');
  // The sample lesson has 20 different characters; wait until the background fetch has cached them all.
  const strokeFilesCached = () =>
    plane.page.evaluate(async () => (await (await caches.open('zuoye-data-v1')).keys()).filter((r) => r.url.includes('/hanzi/')).length);
  let cachedCount = 0;
  for (let waited = 0; waited < 20000 && cachedCount < 20; waited += 250) {
    await plane.page.waitForTimeout(250);
    cachedCount = await strokeFilesCached();
  }
  check('strokes of every lesson character are cached in the background', cachedCount === 20, `${cachedCount} files`);
  await plane.context.setOffline(true);
  await plane.page.reload();
  await plane.page.waitForSelector('a.row');
  check('airplane mode: the app opens with its lessons', (await plane.page.locator('a.row').count()) === 1);

  await plane.page.goto(`${base}#/practice/pinyin`);
  await plane.page.locator('input.pinyin-input').pressSequentially('ni3hao3');
  await button(plane.page, 'Verifica').click();
  check('airplane mode: pinyin exercise works', (await plane.page.locator('.feedback.ok').count()) === 1);
  await button(plane.page, 'Chiudi la sessione').click();

  await plane.page.goto(`${base}#/practice/write`);
  await writeChar(plane.page, '你');
  await writeChar(plane.page, '好');
  await plane.page.waitForSelector('.feedback');
  check('airplane mode: writing works on characters never opened before', (await plane.page.locator('.feedback-title').innerText()) === 'Ben scritto');
  await shot(plane.page, '22-airplane-writing');
  await button(plane.page, 'Chiudi la sessione').click();

  await plane.page.goto(`${base}#/practice/cloze`);
  await plane.page.locator('.option').first().click();
  check('airplane mode: fill-in works', (await plane.page.locator('.feedback').count()) === 1);
  await button(plane.page, 'Chiudi la sessione').click();

  await plane.page.goto(`${base}#/practice/order`);
  await button(plane.page, 'Non lo so').click();
  check('airplane mode: reorder works', (await plane.page.locator('.feedback').count()) === 1);
  await plane.context.setOffline(false);
  await plane.context.close();

  // ---------- dark mode ----------
  const dark = await newPage({ colorScheme: 'dark' });
  await dark.page.goto(`${base}#/lessons`);
  await button(dark.page, 'Carica la lezione di esempio').click();
  await dark.page.waitForSelector('a.row');
  await dark.page.goto(`${base}#/`);
  await dark.page.waitForSelector('button.row');
  await shot(dark.page, '20-dark-home');
  await dark.page.locator('button.row', { hasText: 'Scrittura' }).click();
  await dark.page.waitForSelector('.tian[data-status="ready"]');
  const paths = await strokePaths(dark.page, '你');
  for (const p of paths.slice(0, 4)) await drawPath(dark.page, p);
  await shot(dark.page, '21-dark-writing');
  await dark.context.close();

  // ---------- nothing left the app's origin; no errors ----------
  const outside = [...new Set(requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')))];
  check('every request stayed on the app origin', outside.length === 0, outside.join(', '));
  for (const failure of new Set(failures)) console.log(`failed request: ${failure}`);
  check('no request failed, online or offline', failures.length === 0);
  // Offline, the worker tries the network first for the page itself; that one failure is logged by the browser.
  const expected = (p) => p.includes('ERR_INTERNET_DISCONNECTED');
  check('offline fallback logged at most the page fetch', problems.filter(expected).length <= 2);
  problems.splice(0, problems.length, ...problems.filter((p) => !expected(p)));
  check('no console errors or warnings', problems.length === 0, problems.slice(0, 5).join(' || '));
} catch (error) {
  check('run completed', false, String(error).split('\n')[0]);
  if (problems.length > 0) console.log('console:', problems.slice(0, 8).join('\n'));
  for (const failure of new Set(failures)) console.log(`failed request: ${failure}`);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);

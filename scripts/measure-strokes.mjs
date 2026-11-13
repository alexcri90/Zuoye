// Measures how forgiving each stroke-tolerance setting is, on the BUILT app.
// Every stroke of the sample lesson's characters is drawn imperfectly in
// several ways (shifted, shrunk, straightened, cut short, wobbly) and the
// share of strokes the app accepts is printed for each setting.
// It also draws clearly wrong strokes, which must stay refused.
// Usage: npm run build && node scripts/measure-strokes.mjs
import { startSession } from './e2e-lib.mjs';

const CHARS = [...'你好谢老师学生朋友茶水喝喜欢是不也一点儿'];
const LEVELS = ['precisa', 'normale', 'tollerante'];

const s = await startSession();
const { base, button } = s;

/** Ways a hand departs from the model stroke. `points` are in grid units 0..1 from the top-left corner. */
const DISTORTIONS = {
  'exact': (p) => p,
  'shifted 6%': (p) => p.map(([x, y]) => [x + 0.06, y + 0.06]),
  'shifted 10%': (p) => p.map(([x, y]) => [x + 0.1, y - 0.1]),
  'shifted 14%': (p) => p.map(([x, y]) => [x - 0.14, y + 0.14]),
  'drawn 25% smaller': (p) => p.map(([x, y]) => [0.5 + (x - 0.5) * 0.75, 0.5 + (y - 0.5) * 0.75]),
  'drawn 40% smaller': (p) => p.map(([x, y]) => [0.5 + (x - 0.5) * 0.6, 0.5 + (y - 0.5) * 0.6]),
  'straight line (no curve, no hook)': (p) => [p[0], p.at(-1)],
  'last quarter missing': (p) => p.slice(0, Math.max(2, Math.ceil(p.length * 0.75))),
  'wobbly (5% zigzag)': (p) => p.map(([x, y], i) => [x + (i % 2 ? 0.05 : -0.05), y + (i % 2 ? -0.05 : 0.05)]),
  // These must NOT be accepted at any setting.
  'WRONG: backwards': (p) => [...p].reverse(),
  'WRONG: a dot in the corner': () => [[0.92, 0.92], [0.9, 0.93], [0.88, 0.92]],
  'WRONG: mirrored left-right': (p) => p.map(([x, y]) => [1 - x, y]),
};

async function medians(page, char) {
  const data = await (await fetch(`${base}hanzi/${char.codePointAt(0).toString(16)}.json`)).json();
  // Stroke data is 1024 units wide with y pointing up from -124; the app pads the grid by 7%.
  return data.medians.map((m) => m.map(([x, y]) => [0.07 + (x / 1024) * 0.86, 0.07 + ((900 - y) / 1024) * 0.86]));
}

async function draw(page, box, points) {
  const at = ([x, y]) => [box.x + Math.min(0.99, Math.max(0.01, x)) * box.width, box.y + Math.min(0.99, Math.max(0.01, y)) * box.height];
  const [first, ...rest] = points.map(at);
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}

const state = (page) => page.locator('.tian').evaluate((el) => ({ done: Number(el.dataset.done ?? 0), mistakes: Number(el.dataset.mistakes ?? 0) }));
const done = async (page) => (await state(page)).done;

/** Draws a stroke and waits until the app has judged it. True when it was accepted. */
async function attempt(page, box, points) {
  const before = await state(page);
  await draw(page, box, points);
  for (let waited = 0; waited < 500; waited += 25) {
    const now = await state(page);
    if (now.done > before.done) return true;
    if (now.mistakes > before.mistakes) return false;
    await page.waitForTimeout(25);
  }
  return false;
}

const results = Object.fromEntries(LEVELS.map((l) => [l, Object.fromEntries(Object.keys(DISTORTIONS).map((k) => [k, { ok: 0, all: 0 }]))]));

/**
 * One pass over the writing session at one setting. Each stroke is first tried
 * with the given distortions (an accepted one finishes the stroke, so "right"
 * distortions get a pass each; the "wrong" ones share a pass, since they
 * should all be refused), then drawn properly if still open.
 */
async function pass(level, names) {
  const { context, page } = await s.newPage();
  await context.addInitScript((value) => window.localStorage.setItem('zuoye.prefs', JSON.stringify({ strokes: value, sessionSize: 30 })), level);
  await page.goto(`${base}#/lessons`);
  await button(page, 'Carica la lezione di esempio').click();
  await page.waitForSelector('a.row');
  await page.goto(`${base}#/practice/write`);
  const seen = new Set();
  for (let guard = 0; guard < 80 && seen.size < CHARS.length; guard++) {
    if ((await page.locator('.summary').count()) > 0) break;
    if ((await page.locator('.feedback').count()) > 0) {
      await button(page, 'Avanti').click();
      continue;
    }
    await page.waitForSelector('.tian[data-status="ready"]');
    const char = await page.locator('.tian').getAttribute('data-char');
    const box = await page.locator('.tian > div').boundingBox();
    const strokes = await medians(page, char);
    const measure = !seen.has(char);
    seen.add(char);
    for (let i = 0; i < strokes.length; i++) {
      for (const name of measure ? names : []) {
        if ((await done(page)) > i) break;
        const accepted = name === 'exact' ? false : await attempt(page, box, DISTORTIONS[name](strokes[i]));
        if (name !== 'exact') {
          results[level][name].all++;
          if (accepted) results[level][name].ok++;
        }
      }
      // Whatever happened, finish the stroke properly so the character can go on.
      for (let tries = 0; tries < 4 && (await done(page)) <= i; tries++) {
        if (tries > 0 || !names.includes('exact')) await page.waitForTimeout(200);
        const accepted = await attempt(page, box, strokes[i]);
        if (measure && tries === 0 && names.includes('exact')) {
          results[level].exact.all++;
          if (accepted) results[level].exact.ok++;
        }
      }
    }
    // The next grid is a new element with no progress yet (the character may be the same, as in 谢谢).
    await page.waitForFunction(() => Boolean(document.querySelector('.feedback')) || !document.querySelector('.tian')?.dataset.done);
  }
  await context.close();
}

try {
  const right = Object.keys(DISTORTIONS).filter((n) => !n.startsWith('WRONG'));
  const wrong = Object.keys(DISTORTIONS).filter((n) => n.startsWith('WRONG'));
  const jobs = LEVELS.flatMap((level) => [...right.map((name) => [level, [name]]), [level, wrong]]);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [level, names] = jobs[next++];
      await pass(level, names);
      process.stdout.write('.');
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));

  console.log('\nShare of strokes accepted, by setting:');
  console.log(`${'way the stroke was drawn'.padEnd(36)}${LEVELS.map((l) => l.padStart(12)).join('')}`);
  for (const name of Object.keys(DISTORTIONS)) {
    const cells = LEVELS.map((l) => {
      const { ok, all } = results[l][name];
      return (all === 0 ? '-' : `${Math.round((ok / all) * 100)}% of ${all}`).padStart(12);
    });
    console.log(`${name.padEnd(36)}${cells.join('')}`);
  }
} catch (error) {
  console.log('measurement failed:', String(error?.stack ?? error).split('\n').slice(0, 6).join('\n'));
  if (s.problems.length > 0) console.log('console:', s.problems.slice(0, 5).join('\n'));
}
await s.browser.close();
process.exit(0);

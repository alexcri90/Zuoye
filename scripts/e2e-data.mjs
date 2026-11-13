// Browser check of data portability on the BUILT app: backup export and
// restore on another "device", lesson packs, and refusal of foreign files.
// Usage: npm run build && node scripts/e2e-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { out, startSession } from './e2e-lib.mjs';

const s = await startSession();
const { base, check, shot, button } = s;

async function download(page, trigger) {
  const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const target = path.join(out, file.suggestedFilename());
  await file.saveAs(target);
  return { name: file.suggestedFilename(), target, json: JSON.parse(fs.readFileSync(target, 'utf8')) };
}

const homeCounts = async (page) => {
  await page.goto(`${base}#/`);
  await page.waitForSelector('button.row');
  return (await page.locator('.list').innerText()).replace(/\s+/g, ' ');
};

try {
  // ---------- device A: a lesson and some progress ----------
  const a = await s.newPage({ acceptDownloads: true });
  await a.page.goto(`${base}#/lessons`);
  await button(a.page, 'Carica la lezione di esempio').click();
  await a.page.waitForSelector('a.row');
  await a.page.goto(`${base}#/practice/pinyin`);
  const input = a.page.locator('input.pinyin-input');
  for (const answer of ['ni3hao3', 'xie4xie', 'lao3shi1']) {
    await input.pressSequentially(answer);
    await button(a.page, 'Verifica').click();
    await button(a.page, 'Avanti').click();
  }
  await button(a.page, 'Non lo so').click();
  await button(a.page, 'Avanti').click();
  await button(a.page, 'Chiudi la sessione').click();
  const countsA = await homeCounts(a.page);

  await a.page.goto(`${base}#/settings`);
  await a.page.waitForSelector('text=Esporta un backup');
  const backup = await download(a.page, () => button(a.page, 'Esporta un backup').click());
  check('backup: file is named by date and is one of ours', /^zuoye-backup-\d{4}-\d{2}-\d{2}\.json$/.test(backup.name) && backup.json.app === 'zuoye' && backup.json.kind === 'backup');
  check('backup: holds the lesson and the progress', backup.json.lessons.length === 1 && backup.json.vocab.length === 13 && backup.json.cards.length === 4, `${backup.json.cards.length} cards`);
  check('backup: holds no key', !JSON.stringify(backup.json).toLowerCase().includes('apikey'));
  await shot(a.page, '60-settings-data', true);

  await a.page.goto(`${base}#/lessons`);
  await a.page.locator('a.row').first().click();
  await a.page.waitForSelector('text=Esporta per i compagni');
  const pack = await download(a.page, () => button(a.page, 'Esporta per i compagni').click());
  check('lesson pack: one lesson, no progress', pack.json.kind === 'lesson' && pack.json.vocab.length === 13 && !('cards' in pack.json), pack.name);
  await a.context.close();

  // ---------- device B: restore the backup ----------
  const b = await s.newPage();
  b.page.on('dialog', (d) => void d.accept());
  await b.page.goto(`${base}#/settings`);
  await b.page.waitForSelector('text=Importa un backup o una lezione');
  await b.page.locator('input[type="file"]').setInputFiles(backup.target);
  await b.page.waitForSelector('text=Backup ripristinato');
  check('restore: confirmation names what was restored', (await b.page.locator('.notice').last().innerText()).includes('1 lezione e 4 schede di ripasso'));
  const countsB = await homeCounts(b.page);
  check('restore: same lessons and same progress as on the first device', countsB === countsA, countsB);
  await b.page.goto(`${base}#/settings`);
  await b.page.waitForSelector('text=Esporta un backup');

  // A foreign or damaged file is refused and changes nothing.
  const foreign = path.join(out, 'non-nostro.json');
  fs.writeFileSync(foreign, JSON.stringify({ kind: 'backup', app: 'altra', lessons: [] }));
  await b.page.locator('input[type="file"]').setInputFiles(foreign);
  await b.page.waitForSelector('.notice.bad');
  check('import: a foreign file is refused with an explanation', (await b.page.locator('.notice.bad').innerText()).includes('danneggiato'));
  const broken = path.join(out, 'rotto.json');
  fs.writeFileSync(broken, '{"kind":"lesson", "lesson":');
  await b.page.locator('input[type="file"]').setInputFiles(broken);
  await b.page.waitForSelector('text=non è leggibile');
  check('import: a refused file changes nothing', (await homeCounts(b.page)) === countsA);
  await b.context.close();

  // ---------- device C: a classmate imports the lesson pack ----------
  const c = await s.newPage();
  c.page.on('dialog', (d) => void d.accept());
  await c.page.goto(`${base}#/lessons`);
  await c.page.locator('input[type="file"]').setInputFiles(pack.target);
  await c.page.waitForSelector('text=Lezione importata');
  check('lesson pack: imported with a clear message', (await c.page.locator('.notice').last().innerText()).includes('13 parole'));
  check('lesson pack: the lesson is listed once', (await c.page.locator('a.row').count()) === 1);
  const countsC = await homeCounts(c.page);
  check('lesson pack: everything is new, no progress came along', countsC.includes('0 +13 nuovi') && !countsC.includes('+9 nuovi'), countsC);
  await shot(c.page, '61-pack-imported');
  // Importing it again asks before replacing, and does not duplicate.
  await c.page.goto(`${base}#/lessons`);
  await c.page.locator('input[type="file"]').setInputFiles(pack.target);
  await c.page.waitForSelector('text=Lezione importata');
  check('lesson pack: importing twice does not duplicate the lesson', (await c.page.locator('a.row').count()) === 1);

  // Markup inside an imported file is shown as text, never run.
  const hostile = { ...pack.json, lesson: { ...pack.json.lesson, id: 'ostile', title: '<img src=x onerror="window.__pwned=1">Titolo' } };
  for (const key of ['vocab', 'grammar', 'sentences', 'clozes']) hostile[key] = pack.json[key].map((r) => ({ ...r, id: `ostile-${r.id}`, lessonId: 'ostile' }));
  hostile.vocab[0] = { ...hostile.vocab[0], meaning: '<script>window.__pwned=1</script>ciao' };
  const hostileFile = path.join(out, 'ostile.json');
  fs.writeFileSync(hostileFile, JSON.stringify(hostile));
  await c.page.locator('input[type="file"]').setInputFiles(hostileFile);
  await c.page.waitForSelector('text=Lezione importata');
  await c.page.locator('a.row', { hasText: 'Titolo' }).click();
  await c.page.waitForSelector('[role="tablist"]');
  const pwned = await c.page.evaluate(() => window.__pwned === 1 || document.querySelector('img[src="x"]') !== null);
  check('import: markup in a file is rendered as text', !pwned && (await c.page.locator('h1').innerText()).includes('<img src=x'));
  await shot(c.page, '62-hostile-as-text');

  // Storage persistence is reported (headless browsers may refuse it; the screen must cope either way).
  await c.page.goto(`${base}#/settings`);
  await c.page.waitForSelector('text=Archivio:');
  await c.page.waitForFunction(() => /Archivio: (protetto|non protetto|non disponibile)/.test(document.body.innerText));
  const archive = (await c.page.locator('.page').innerText()).match(/Archivio: ([a-z ]+)/)?.[1];
  check('storage: persistence state is shown', Boolean(archive), archive);
  await c.context.close();

  const outside = [...new Set(s.requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')))];
  check('every request stayed on the app origin', outside.length === 0, outside.join(', '));
  check('no console errors', s.problems.length === 0, s.problems.slice(0, 4).join(' || '));
} catch (error) {
  check('run completed', false, String(error).split('\n')[0]);
  if (s.problems.length > 0) console.log('console:\n' + s.problems.slice(0, 8).join('\n'));
}
await s.finish();

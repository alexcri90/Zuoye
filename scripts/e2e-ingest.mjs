// Browser check of lesson ingestion on the BUILT app. The model endpoint is
// intercepted and answered with a made-up lesson, so nothing reaches Google.
// With the course files in materiali/ the real PDFs go through the real reader;
// without them (for example in CI) a generated Word file is used.
// Usage: npm run build && node scripts/e2e-ingest.mjs   (E2E_ALL=1 reads every lesson)
import fs from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { root, startSession } from './e2e-lib.mjs';

const FAKE_KEY = 'TEST-ONLY-not-a-real-key-0123456789';
const API = 'https://generativelanguage.googleapis.com';
const materiali = path.join(root, 'materiali');

// ---------- made-up model answers ----------
const CART = String.fromCodePoint(0x2ecb); // look-alike of 车, as found in real slides
const extraction = {
  title: 'I mezzi di trasporto',
  number: 0,
  summary: 'Si impara a dire con quale mezzo ci si sposta.',
  vocab: [
    { hanzi: `公交${CART}`, pinyin: 'gong1jiao1che1', meaning: 'autobus', pos: 'N.', note: '' },
    { hanzi: '地铁', pinyin: 'dìtiě', meaning: 'metropolitana', pos: 'N.', note: '' },
    { hanzi: '坐', pinyin: 'zuò', meaning: 'prendere (un mezzo)', pos: 'V.', note: '' },
    { hanzi: '骑', pinyin: 'cavallo', meaning: 'andare in bici', pos: 'V.', note: '' },
    { hanzi: '学校', pinyin: 'xuéxiào', meaning: 'scuola', pos: 'N.', note: '' },
    { hanzi: 'bus', pinyin: 'bus', meaning: 'voce senza caratteri', pos: '', note: '' },
  ],
  grammar: [
    {
      title: 'Il mezzo di trasporto',
      pattern: '坐 + mezzo + 去 + luogo',
      explanation: 'Il mezzo va prima del verbo di movimento.',
      examples: [{ zh: '我坐地铁去学校。', pinyin: 'Wǒ zuò dìtiě qù xuéxiào.', it: 'Vado a scuola in metro.' }],
    },
  ],
  sentences: [
    { zh: '我坐地铁去学校。', pinyin: 'Wǒ zuò dìtiě qù xuéxiào.', it: 'Vado a scuola in metro.', words: ['我', '坐', '地铁', '去', '学校'], source: 'lezione' },
    { zh: `他坐公交${CART}去学校。`, pinyin: 'Tā zuò gōngjiāochē qù xuéxiào.', it: 'Lui va a scuola in autobus.', words: ['他', '坐', `公交${CART}`, '去', '学校'], source: 'compiti' },
  ],
  clozes: [
    { text: '我___地铁去学校。', answer: '坐', options: ['坐', '骑', '去'], translation: 'Vado a scuola in metro.', explanation: 'Con la metro si usa 坐.', source: 'compiti' },
  ],
};
const generation = {
  sentences: [{ zh: '她坐地铁去学校。', pinyin: 'Tā zuò dìtiě qù xuéxiào.', it: 'Lei va a scuola in metro.', words: ['她', '坐', '地铁', '去', '学校'] }],
  clozes: [{ text: '他____公交车去。', answer: '坐', options: ['坐', '骑', '学校'], translation: 'Lui va in autobus.', explanation: 'Con l’autobus si usa 坐.' }],
};

const answer = (value) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] });

const s = await startSession();
const { base, check, shot, button } = s;
const seen = []; // what the app sent to the model endpoint
let mode = 'ok';

async function mockModel(context) {
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = request.url();
    const headers = request.headers();
    if (request.method() === 'GET') {
      seen.push({ kind: 'models', url, key: headers['x-goog-api-key'] });
      await route.fulfill({
        json: {
          models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          ],
        },
      });
      return;
    }
    const raw = request.postData() ?? '';
    const body = JSON.parse(raw);
    const system = body.systemInstruction?.parts?.[0]?.text ?? '';
    const parts = body.contents?.[0]?.parts ?? [];
    const kind = system.includes('schede di studio') ? 'extraction' : system.includes('nuovi esercizi') ? 'generation' : 'grading';
    seen.push({
      kind,
      url,
      key: headers['x-goog-api-key'],
      bytes: raw.length,
      images: parts.filter((p) => p.inlineData).length,
      text: parts.map((p) => p.text ?? '').join('\n'),
      config: body.generationConfig,
    });
    if (mode === 'quota') {
      await route.fulfill({ status: 429, json: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'daily quota' } } });
    } else if (mode === 'badkey') {
      await route.fulfill({ status: 400, json: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.' } } });
    } else {
      await route.fulfill({ json: answer(kind === 'extraction' ? extraction : generation) });
    }
  });
}

/** A small Word file written here, so the check also runs without the course files. */
function fixtureDocx() {
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${p('Riempi gli spazi')}${p('我___地铁去学校。')}${p('Traduci in cinese')}${p('Vado a scuola in autobus.')}</w:body></w:document>`;
  const file = path.join(s.base ? root : root, 'e2e-out', 'compiti-di-prova.docx');
  fs.writeFileSync(file, zipSync({ 'word/document.xml': strToU8(xml) }));
  return file;
}

const lessonFiles = (n) => {
  const all = fs.existsSync(materiali) ? fs.readdirSync(materiali) : [];
  return all.filter((f) => f.startsWith(String(n).padStart(2, '0')) && /\.(pdf|docx)$/.test(f)).map((f) => path.join(materiali, f));
};

try {
  const { context, page } = await s.newPage();
  await mockModel(context);

  // ---------- key in Settings ----------
  await page.goto(`${base}#/lessons/new`);
  await page.waitForSelector('.page');
  check('without a key, extraction is not offered', await button(page, 'Estrai la lezione').isDisabled());
  await shot(page, '30-add-no-key');

  await page.goto(`${base}#/settings`);
  await page.locator('input[type="password"]').fill('troppo corta');
  await button(page, 'Salva chiave').click();
  check('a malformed key is refused', (await page.locator('.notice.bad').count()) === 1);
  await page.locator('input[type="password"]').fill(FAKE_KEY);
  await button(page, 'Salva chiave').click();
  await page.waitForSelector('text=Chiave salvata');
  const settingsText = await page.locator('.page').innerText();
  check('the saved key is shown masked', settingsText.includes('6789') && !settingsText.includes(FAKE_KEY));
  check('the key is nowhere in the page markup', !(await page.content()).includes(FAKE_KEY));
  await button(page, 'Verifica chiave').click();
  await page.waitForSelector('text=Chiave valida');
  check('"Verifica chiave" lists the models', (await page.locator('.page').innerText()).includes('2 modelli disponibili'));
  await shot(page, '31-settings-key', true);

  // ---------- add a lesson ----------
  const real = lessonFiles(2);
  const files = real.length > 0 ? real : [fixtureDocx()];
  console.log(`using ${real.length > 0 ? 'the real lesson 2 files' : 'a generated Word file'} (${files.length} file)`);
  await page.goto(`${base}#/lessons/new`);
  await page.locator('input[type="file"]').setInputFiles(files);
  await shot(page, '32-add-files');
  await button(page, 'Estrai la lezione').click();
  await page.waitForSelector('text=Controlla', { timeout: 240000 });

  const sent = seen.find((x) => x.kind === 'extraction');
  check('extraction: one request to the model', seen.filter((x) => x.kind === 'extraction').length === 1);
  check('extraction: key sent in the header, not in the URL', sent.key === FAKE_KEY && !sent.url.includes(FAKE_KEY));
  check('extraction: request has a JSON schema and no sampling options', Boolean(sent.config?.responseJsonSchema) && !('temperature' in (sent.config ?? {})));
  check('extraction: request stays under the size limit', sent.bytes < 19_000_000, `${(sent.bytes / 1e6).toFixed(1)} MB, ${sent.images} page images`);
  check('extraction: lesson text was read', /\p{Script=Han}/u.test(sent.text), `${sent.text.length} characters of text`);
  check('extraction: no radical look-alikes are sent', ![...sent.text].some((c) => c.codePointAt(0) >= 0x2e80 && c.codePointAt(0) <= 0x2fdf));
  check('extraction: file names are not sent', !files.some((f) => sent.text.includes(path.basename(f))));
  if (real.length > 0) check('extraction: page images were rendered', sent.images >= 20, `${sent.images} images`);

  // ---------- review ----------
  const words = page.locator('details.group').first().locator('.edit-row');
  check('review: words without Chinese characters are dropped', (await words.count()) === 5);
  check('review: look-alike characters are fixed', (await words.nth(0).locator('input').nth(0).inputValue()) === '公交车');
  check('review: tone numbers are converted', (await words.nth(0).locator('input').nth(1).inputValue()) === 'gōngjiāochē');
  check('review: doubtful pinyin is marked', (await page.locator('.edit-row.suspect').count()) === 1);
  await shot(page, '33-review', true);
  const suspect = page.locator('.edit-row.suspect input').nth(1);
  await suspect.fill('qí');
  check('review: fixing the pinyin clears the mark', (await page.locator('.edit-row.suspect').count()) === 0);
  await page.getByRole('button', { name: 'Elimina 学校' }).click();
  check('review: a word can be removed', (await words.count()) === 4);

  // ---------- save and generate ----------
  await button(page, 'Salva la lezione').click();
  await page.waitForSelector('text=Lezione salvata', { timeout: 30000 });
  const done = await page.locator('.notice').innerText();
  check('save: extra exercises are generated', done.includes('1 frasi') && done.includes('1 esercizi'), done);
  const generationRequest = seen.find((x) => x.kind === 'generation');
  check('generation: text only', generationRequest.images === 0 && generationRequest.text.includes('地铁'));
  await button(page, 'Apri la lezione').click();
  await page.waitForSelector('[role="tablist"]');
  const detail = await page.locator('.page').innerText();
  check('detail: the edited pinyin was saved', detail.includes('qí') && !detail.includes('cavallo'));
  check('detail: counts match what was kept', detail.includes('Parole 4') && detail.includes('Frasi 3') && detail.includes('Esercizi 2'), detail.split('\n').filter((l) => /^(Parole|Frasi|Esercizi|Grammatica) \d/.test(l)).join(', '));
  await shot(page, '34-lesson-detail', true);
  await page.getByRole('tab', { name: /Frasi/ }).click();
  await shot(page, '35-lesson-sentences', true);
  await page.getByRole('tab', { name: /Grammatica/ }).click();
  await shot(page, '36-lesson-grammar', true);

  // The lesson number comes from the file name when the model gives none.
  await page.goto(`${base}#/lessons`);
  await page.waitForSelector('a.row');
  if (real.length > 0) check('lesson number taken from the file name', (await page.locator('a.row').first().innerText()).startsWith('2.'));

  // The new words are practicable straight away.
  await page.goto(`${base}#/`);
  await page.waitForSelector('button.row');
  check('home: the new words can be practised', (await page.locator('.list').innerText()).includes('+4 nuovi'));

  // ---------- failures are explained and nothing is saved ----------
  for (const [m, expected] of [['quota', 'Quota gratuita esaurita'], ['badkey', 'Chiave non valida']]) {
    mode = m;
    await page.goto(`${base}#/lessons/new`);
    await page.locator('input[type="file"]').setInputFiles([fixtureDocx()]);
    await button(page, 'Estrai la lezione').click();
    await page.waitForSelector('.notice.bad');
    const message = await page.locator('.notice.bad').innerText();
    check(`failure "${m}" is explained in Italian`, message.includes(expected), message);
    check(`failure "${m}" does not show the key`, !message.includes(FAKE_KEY));
  }
  await shot(page, '37-add-error');
  mode = 'ok';
  await page.goto(`${base}#/lessons`);
  await page.waitForSelector('a.row');
  check('a failed extraction saves nothing', (await page.locator('a.row').count()) === 1);

  // ---------- deleting a lesson ----------
  page.on('dialog', (d) => void d.accept());
  await page.locator('a.row').first().click();
  await button(page, 'Elimina la lezione').click();
  await page.waitForSelector('text=Aggiungi una lezione');
  check('a lesson can be deleted', (await page.locator('a.row').count()) === 0);

  // ---------- every real lesson through the reader ----------
  if (process.env.E2E_ALL === '1') {
    for (let n = 1; n <= 7; n++) {
      const set = lessonFiles(n);
      if (set.length === 0) continue;
      const before = seen.length;
      const started = Date.now();
      await page.goto(`${base}#/lessons/new`);
      await page.locator('input[type="file"]').setInputFiles(set);
      await button(page, 'Estrai la lezione').click();
      await page.waitForSelector('text=Controlla', { timeout: 300000 });
      const r = seen.slice(before).find((x) => x.kind === 'extraction');
      const warnings = await page.locator('.notice.small').allInnerTexts();
      check(`lesson ${n}: read and sent`, Boolean(r) && r.bytes < 19_000_000, `${set.length} files, ${r?.images} images, ${(r?.bytes / 1e6).toFixed(1)} MB, ${r?.text.length} chars, ${Math.round((Date.now() - started) / 1000)} s`);
      const unread = warnings.join(' ').match(/non sono riuscito a leggerlo/g)?.length ?? 0;
      check(`lesson ${n}: every file readable`, unread === 0, warnings.join(' | ').slice(0, 200));
    }
  }

  await context.close();

  const outside = [...new Set(s.requests.filter((u) => !u.startsWith(base) && !u.startsWith(API) && !u.startsWith('data:') && !u.startsWith('blob:')))];
  check('requests went only to the app and the model endpoint', outside.length === 0, outside.join(', '));
  for (const failure of new Set(s.failures)) console.log(`failed request: ${failure}`);
  // The two simulated failures (429, 400) are logged by the browser as failed resources.
  const unexpected = s.problems.filter((p) => !/status of (429|400)/.test(p));
  check('no console errors (CSP included) while reading PDFs', unexpected.length === 0, unexpected.slice(0, 4).join(' || '));
} catch (error) {
  check('run completed', false, String(error).split('\n')[0]);
  if (s.problems.length > 0) console.log('console:\n' + s.problems.slice(0, 8).join('\n'));
}
await s.finish();

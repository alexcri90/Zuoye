// Browser check of the sentence exercises on the BUILT app: translation both
// ways (model grading mocked, plus the fallbacks), fill-in-the-blank, reorder.
// Usage: npm run build && node scripts/e2e-sentences.mjs
import { startSession } from './e2e-lib.mjs';

const FAKE_KEY = 'TEST-ONLY-not-a-real-key-0123456789';
const API = 'https://generativelanguage.googleapis.com';

// The sentences of the built-in sample lesson, plus its stored fill-in, completed.
const SENTENCES = ['我是学生。', '她是我的老师。', '我喜欢喝茶。', '我的朋友不喝茶。', '老师也喜欢喝水。', '我也喜欢喝茶。'];
const WORDS = { '我是学生。': ['我', '是', '学生'] };

const VERDICTS = {
  quasi: {
    verdict: 'quasi',
    score: 75,
    corrected: '她是我的老师。',
    correctedPinyin: 'Tā shì wǒ de lǎoshī.',
    comment: 'Il senso c’è, ma manca la particella 的 dopo 我.',
    errors: [{ type: 'grammatica', detail: 'Tra 我 e 老师 serve 的.' }],
  },
  corretta: { verdict: 'corretta', score: 96, corrected: '我爱喝茶。', correctedPinyin: 'Wǒ ài hē chá.', comment: 'Va bene: 爱 qui vale come 喜欢.', errors: [] },
  errata: {
    verdict: 'errata',
    score: 20,
    corrected: 'Sono uno studente.',
    correctedPinyin: '',
    comment: 'Hai tradotto 学生 come insegnante: significa studente.',
    errors: [{ type: 'lessico', detail: '学生 = studente, non insegnante.' }],
  },
};

const s = await startSession();
const { base, check, shot, button } = s;
const graded = []; // grading requests seen by the mocked endpoint
let mode = 'quasi';

async function mockModel(context) {
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    const body = JSON.parse(request.postData() ?? '{}');
    graded.push({
      system: body.systemInstruction?.parts?.[0]?.text ?? '',
      text: (body.contents?.[0]?.parts ?? []).map((p) => p.text ?? '').join('\n'),
      config: body.generationConfig ?? {},
      key: request.headers()['x-goog-api-key'],
    });
    if (mode === 'quota') {
      await route.fulfill({ status: 429, json: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'daily quota' } } });
      return;
    }
    await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(VERDICTS[mode]) }] }, finishReason: 'STOP' }] } });
  });
}

async function withSample(page) {
  await page.goto(`${base}#/lessons`);
  await button(page, 'Carica la lezione di esempio').click();
  await page.waitForSelector('a.row');
}

const answerBox = (page) => page.locator('textarea');
const feedbackTitle = (page) => page.locator('.feedback-title').innerText();

try {
  // ---------- translation with a key: exact match, model verdicts, quota fallback ----------
  const { context, page } = await s.newPage();
  await context.addInitScript((key) => window.localStorage.setItem('zuoye.apiKey', key), FAKE_KEY);
  await mockModel(context);
  await withSample(page);

  await page.goto(`${base}#/`);
  await page.waitForSelector('button.row');
  check('home lists all six exercise types', (await page.locator('button.row').count()) === 6);
  await shot(page, '40-home-six');

  await page.goto(`${base}#/practice/it-zh`);
  await answerBox(page).waitFor();
  check('it-zh: the Italian sentence is the prompt', (await page.locator('.prompt-meaning').innerText()) === 'Sono uno studente.');
  await answerBox(page).fill('我是学生');
  await shot(page, '41-translate-typing');
  await button(page, 'Verifica').click();
  await page.waitForSelector('.feedback');
  check('it-zh: the reference without punctuation is right, with no request', (await feedbackTitle(page)) === 'Giusto' && graded.length === 0);
  await shot(page, '42-translate-exact');
  await button(page, 'Avanti').click();

  mode = 'quasi';
  await answerBox(page).fill('她是我老师');
  await button(page, 'Verifica').click();
  await page.waitForSelector('.feedback');
  const quasi = await page.locator('.feedback').innerText();
  check('it-zh: a different answer costs one request', graded.length === 1);
  check('it-zh: verdict, score, comment, correction and error are shown', quasi.includes('Quasi giusta') && quasi.includes('75/100') && quasi.includes('manca la particella') && quasi.includes('她是我的老师。') && quasi.includes('Tā shì wǒ de lǎoshī.') && quasi.includes('grammatica'), quasi.replace(/\n/g, ' | ').slice(0, 160));
  check('it-zh: request names the direction, wraps the answer as data, asks for little thinking', graded[0].system.includes("dall'italiano al cinese") && graded[0].text.includes('她是我老师') && graded[0].config.thinkingConfig?.thinkingLevel === 'LOW' && graded[0].key === FAKE_KEY);
  await shot(page, '43-translate-quasi');
  await button(page, 'Avanti').click();

  mode = 'corretta';
  await answerBox(page).fill('我爱喝茶');
  await button(page, 'Verifica').click();
  await page.waitForSelector('.feedback');
  check('it-zh: an answer the model accepts is shown as correct', (await feedbackTitle(page)).startsWith('Corretta'));
  await shot(page, '44-translate-corretta');
  await button(page, 'Avanti').click();

  mode = 'quota';
  await answerBox(page).fill('我朋友不喝茶');
  await button(page, 'Verifica').click();
  await page.waitForSelector('.feedback');
  const self = await page.locator('.feedback').innerText();
  check('it-zh: out of quota falls back to self-assessment with the solution', self.includes('Confronta con la soluzione') && self.includes('Quota gratuita esaurita') && self.includes('我的朋友不喝茶。'));
  check('it-zh: three self-assessment buttons', (await page.getByRole('group', { name: "Com'era la tua risposta?" }).locator('button').count()) === 3);
  await shot(page, '45-translate-self');
  await button(page, 'Quasi').click();

  // With the quota gone, the next answer does not even try the model.
  mode = 'corretta';
  const whenPaused = graded.length;
  await answerBox(page).fill('老师喜欢水');
  await button(page, 'Verifica').click();
  await page.waitForSelector('.feedback');
  check('it-zh: after a quota failure the model is left alone for a while', (await feedbackTitle(page)) === 'Confronta con la soluzione' && graded.length === whenPaused);
  await button(page, 'Sbagliata').click();
  await button(page, 'Chiudi la sessione').click();
  await page.waitForSelector('button.row');
  await page.reload(); // a fresh start of the app ends the pause
  await page.waitForSelector('button.row');

  // The accepted answer is remembered: the same answer again costs nothing.
  mode = 'errata';
  const before = graded.length;
  await page.goto(`${base}#/practice/it-zh?extra=1`);
  await answerBox(page).waitFor();
  let remembered = false;
  for (let guard = 0; guard < 12 && !remembered; guard++) {
    if ((await page.locator('.prompt-meaning').innerText()) === 'Mi piace bere il tè.') {
      await answerBox(page).fill('我爱喝茶。');
      await button(page, 'Verifica').click();
      await page.waitForSelector('.feedback');
      remembered = (await feedbackTitle(page)) === 'Giusto';
    } else {
      await button(page, 'Non lo so').click();
    }
    await button(page, 'Avanti').click();
  }
  check('it-zh: an answer judged correct once is accepted later without a request', remembered && graded.length === before);

  // ---------- Chinese to Italian ----------
  mode = 'errata';
  await page.goto(`${base}#/practice/zh-it`);
  await answerBox(page).waitFor();
  check('zh-it: the Chinese sentence is the prompt, without pinyin', (await page.locator('.zh-sentence').innerText()) === '我是学生。' && (await page.locator('.prompt .pinyin-small').count()) === 0);
  await answerBox(page).fill('Sono un insegnante');
  await button(page, 'Verifica').click();
  await page.waitForSelector('.feedback');
  const errata = await page.locator('.feedback').innerText();
  check('zh-it: a wrong answer is explained', errata.includes('Da rivedere') && errata.includes('lessico') && errata.includes('Sono uno studente.'));
  check('zh-it: request names the other direction', graded.at(-1).system.includes("dal cinese all'italiano"));
  check('zh-it: pinyin appears once answered', (await page.locator('.prompt .pinyin-small').count()) === 1);
  await shot(page, '46-translate-errata');
  await button(page, 'Avanti').click();
  await answerBox(page).fill('lei e la mia insegnante');
  await button(page, 'Verifica').click();
  await page.waitForSelector('.feedback');
  check('zh-it: accents and capitals do not matter for an exact match', (await feedbackTitle(page)) === 'Giusto');
  await button(page, 'Avanti').click();
  await button(page, 'Non lo so').click();
  check('zh-it: giving up shows the solution', (await feedbackTitle(page)) === 'Ecco la soluzione');

  // ---------- offline ----------
  await button(page, 'Avanti').click();
  await context.setOffline(true);
  const offlineBefore = graded.length;
  await answerBox(page).fill('Il mio amico beve');
  await button(page, 'Verifica').click();
  await page.waitForSelector('.feedback');
  check('offline: self-assessment, and no request is attempted', (await page.locator('.feedback').innerText()).includes('Sei offline') && graded.length === offlineBefore);
  await context.setOffline(false);
  await button(page, 'Giusta').click();
  await button(page, 'Chiudi la sessione').click();

  // ---------- fill in the blank ----------
  await page.goto(`${base}#/practice/cloze`);
  await page.waitForSelector('.options');
  const solve = async () => {
    const [head, tail] = await page.locator('.zh-sentence').evaluate((el) => {
      const parts = [...el.querySelectorAll(':scope > .zh')].map((x) => x.textContent ?? '');
      return [parts[0] ?? '', parts.at(-1) ?? ''];
    });
    const full = SENTENCES.find((x) => x.startsWith(head) && x.endsWith(tail) && x.length > head.length + tail.length);
    return full ? full.slice(head.length, full.length - tail.length) : null;
  };
  const right = await solve();
  const options = await page.locator('.option').allInnerTexts();
  check('cloze: the answer is among three or four options', right !== null && options.includes(right) && options.length >= 3 && new Set(options).size === options.length, `${right} in ${options.join(' ')}`);
  await shot(page, '47-cloze');
  await page.locator('.option', { hasText: new RegExp(`^${right}$`) }).click();
  check('cloze: the right choice is confirmed', (await feedbackTitle(page)) === 'Giusto' && (await page.locator('.gap.ok').innerText()) === right);
  await shot(page, '48-cloze-right');
  await button(page, 'Avanti').click();

  const right2 = await solve();
  const wrong = (await page.locator('.option').allInnerTexts()).find((o) => o !== right2);
  await page.locator('.option', { hasText: new RegExp(`^${wrong}$`) }).click();
  check('cloze: a wrong choice is marked and the right one shown', (await feedbackTitle(page)) === 'Sbagliato' && (await page.locator('.option.right').innerText()) === right2 && (await page.locator('.option.wrong').innerText()) === wrong);
  check('cloze: the translation appears after answering', (await page.locator('.feedback').innerText()).split('\n').length >= 2);
  await shot(page, '49-cloze-wrong');
  await button(page, 'Chiudi la sessione').click();

  // ---------- reorder ----------
  await page.goto(`${base}#/practice/order`);
  await page.waitForSelector('.tiles');
  const shown = await page.locator('.tiles .tile').allInnerTexts();
  const words = WORDS['我是学生。'];
  check('order: every word is a tile, not in the right order', [...shown].sort().join() === [...words].sort().join() && shown.join('') !== words.join(''), shown.join(' '));
  check('order: cannot be checked before every word is placed', await button(page, 'Verifica').isDisabled());
  await page.locator('.tiles .tile').first().click();
  await page.locator('.answer-line .tile').first().click();
  check('order: a placed word can be taken back', (await page.locator('.tiles .tile').count()) === words.length);
  for (const w of words) await page.locator('.tiles .tile', { hasText: new RegExp(`^${w}$`) }).first().click();
  await shot(page, '50-order-placed');
  await button(page, 'Verifica').click();
  check('order: the right order is confirmed', (await feedbackTitle(page)) === 'Giusto');
  await shot(page, '51-order-right');
  await button(page, 'Avanti').click();

  const count = await page.locator('.tiles .tile').count();
  for (let i = 0; i < count; i++) await page.locator('.tiles .tile').first().click(); // the scrambled order, as shown
  await button(page, 'Verifica').click();
  const orderWrong = await page.locator('.feedback').innerText();
  check('order: a wrong order shows the sentence with its pinyin', orderWrong.includes("L'ordine non è questo") && orderWrong.includes('她是我的老师。') && orderWrong.includes('Tā shì wǒ de lǎoshī.'));
  await shot(page, '52-order-wrong');
  await context.close();

  // ---------- no key: nothing is sent ----------
  const bare = await s.newPage();
  let reached = 0;
  await bare.context.route(`${API}/**`, (route) => {
    reached++;
    return route.abort();
  });
  await withSample(bare.page);
  await bare.page.goto(`${base}#/practice/zh-it`);
  await answerBox(bare.page).waitFor();
  await answerBox(bare.page).fill('Sono studente');
  await button(bare.page, 'Verifica').click();
  await bare.page.waitForSelector('.feedback');
  const noKey = await bare.page.locator('.feedback').innerText();
  check('no key: self-assessment with the solution, and nothing is sent', noKey.includes('Manca la chiave API') && noKey.includes('Sono uno studente.') && reached === 0);
  await shot(bare.page, '53-translate-no-key');
  await button(bare.page, 'Giusta').click();
  await bare.context.close();

  const outside = [...new Set(s.requests.filter((u) => !u.startsWith(base) && !u.startsWith(API) && !u.startsWith('data:') && !u.startsWith('blob:')))];
  check('requests went only to the app and the model endpoint', outside.length === 0, outside.join(', '));
  const unexpected = s.problems.filter((p) => !/status of 429/.test(p));
  check('no console errors', unexpected.length === 0, unexpected.slice(0, 4).join(' || '));
} catch (error) {
  check('run completed', false, String(error).split('\n')[0]);
  if (s.problems.length > 0) console.log('console:\n' + s.problems.slice(0, 8).join('\n'));
}
await s.finish();

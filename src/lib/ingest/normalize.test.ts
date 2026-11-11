import { describe, expect, it } from 'vitest';
import {
  BLANK,
  ClozeSchema,
  ExtractionSchema,
  GenerationSchema,
  GrammarSchema,
  LessonSchema,
  SentenceSchema,
  VocabSchema,
} from '../schema.ts';
import {
  cleanSentence,
  cleanWord,
  draftToBundle,
  lessonNumberFromNames,
  normalizeExtraction,
  normalizeGeneration,
  pinyinIsSuspect,
  unifyBlank,
} from './normalize.ts';

const cp = (n: number) => String.fromCodePoint(n);
const CART = cp(0x2ecb); // look-alike of 车
const BIG = cp(0x2f24); // look-alike of 大

/** A model answer as it could really arrive: mostly right, with the usual flaws. */
const rawExtraction = {
  title: ' I mezzi di trasporto ',
  number: 0,
  summary: 'Si impara a dire come ci si sposta.',
  vocab: [
    { hanzi: `公交${CART}`, pinyin: 'gong1jiao1che1', meaning: ' autobus ', pos: 'N.', note: '' },
    { hanzi: '地铁 (dìtiě)', pinyin: 'dìtiě', meaning: 'metropolitana', pos: 'N.', note: '' },
    { hanzi: `公交${CART}`, pinyin: 'gōngjiāochē', meaning: 'doppione', pos: 'N.', note: '' },
    { hanzi: 'bus', pinyin: 'bus', meaning: 'senza caratteri', pos: '', note: '' },
    { hanzi: '坐', pinyin: 'zuò', meaning: 'prendere (un mezzo)', pos: 'V.', note: '' },
    { hanzi: '骑', pinyin: 'cavalcare', meaning: 'andare in bici', pos: 'V.', note: '' },
    { hanzi: '自行车', pinyin: 'zìxíng', meaning: 'bicicletta', pos: 'N.', note: '' },
    { hanzi: '一点儿', pinyin: 'yìdiǎnr', meaning: "un po'", pos: '', note: '' },
  ],
  grammar: [
    {
      title: 'Mezzo di trasporto',
      pattern: `坐 + mezzo + 去 + luogo (${BIG})`,
      explanation: 'Il mezzo va prima del verbo di movimento.',
      examples: [
        { zh: '我 坐 地铁 去 学校 。', pinyin: 'Wo3 zuo4 di4tie3 qu4 xue2xiao4.', it: 'Vado a scuola in metro.' },
        { zh: 'solo italiano', pinyin: '', it: 'x' },
      ],
    },
    { title: '', pattern: '', explanation: '', examples: [] },
  ],
  sentences: [
    { zh: '我坐地铁去学校。', pinyin: 'Wǒ zuò dìtiě qù xuéxiào.', it: 'Vado a scuola in metro.', words: ['我', '坐', '地铁', '去', '学校'], source: 'lezione' },
    { zh: '我 坐地铁去学校', pinyin: 'x', it: 'doppione senza punto', words: [], source: 'compiti' },
    { zh: `他坐公交${CART}去。`, pinyin: 'Tā zuò gōngjiāochē qù.', it: 'Lui va in autobus.', words: ['他', '坐', `公交${CART}`, '去。'], source: 'compiti' },
    { zh: '你怎么去学校？', pinyin: 'Nǐ zěnme qù xuéxiào?', it: 'Come vai a scuola?', words: ['你', '怎么', '学校'], source: 'lezione' },
    { zh: 'Come vai?', pinyin: '', it: 'senza cinese', words: [], source: 'lezione' },
  ],
  clozes: [
    { text: '我___地铁去学校。', answer: '坐', options: ['坐', '骑', '开'], translation: 'Vado a scuola in metro.', explanation: 'Con la metro si usa 坐.', source: 'compiti' },
    { text: '他（ ）自行车去。', answer: '骑', options: ['坐'], translation: 'Va in bici.', explanation: '', source: 'compiti' },
    { text: '我 _____ 你 _____ 。', answer: '爱', options: ['爱', '好'], translation: 'due spazi', explanation: '', source: 'compiti' },
    { text: '没有空格。', answer: '好', options: ['好', '坏'], translation: 'nessuno spazio', explanation: '', source: 'compiti' },
    { text: '我____车。', answer: '开', options: [], translation: 'una sola scelta', explanation: '', source: 'compiti' },
    { text: '我____地铁去学校。', answer: '坐', options: ['坐', '开'], translation: 'doppione', explanation: '', source: 'compiti' },
  ],
};

const draft = normalizeExtraction(ExtractionSchema.parse(rawExtraction), new Set(['坐']), 4);

describe('small cleaners', () => {
  it('cleanWord keeps only the word', () => {
    expect(cleanWord(' 公交车 ')).toBe('公交车');
    expect(cleanWord('地铁（dìtiě）')).toBe('地铁');
    expect(cleanWord('T恤')).toBe('T恤');
    expect(cleanWord('gōngjiāochē')).toBe('');
    expect(cleanWord(`${BIG}学`)).toBe('大学');
  });

  it('cleanSentence removes spaces between characters but not inside Latin text', () => {
    expect(cleanSentence(' 我 坐 地铁 。 ')).toBe('我坐地铁。');
    expect(cleanSentence('Marco Rossi 是 我 的 朋友')).toBe('Marco Rossi是我的朋友');
  });

  it('unifyBlank turns every kind of gap into the blank', () => {
    for (const gap of ['__', '___', '_____', '＿＿＿', '__ __', '（ ）', '()', '(  )']) {
      expect(unifyBlank(`我${gap}茶`), gap).toBe(`我${BLANK}茶`);
    }
    expect(unifyBlank('a_b')).toBe('a_b');
  });

  it('reads the lesson number from file names', () => {
    expect(lessonNumberFromNames(['03 - Lezione 3.pdf', '03b - Esercizi.docx'])).toBe(3);
    expect(lessonNumberFromNames(['Lezione 12.pdf'])).toBe(12);
    expect(lessonNumberFromNames(['appunti.txt'])).toBe(0);
  });

  it('flags pinyin that needs a human look', () => {
    expect(pinyinIsSuspect('gōngjiāochē', '公交车')).toBe(false);
    expect(pinyinIsSuspect('yìdiǎnr', '一点儿')).toBe(false);
    expect(pinyinIsSuspect('shéi / shuí', '谁')).toBe(false);
    expect(pinyinIsSuspect('', '车')).toBe(true);
    expect(pinyinIsSuspect('bus', '车')).toBe(true);
    expect(pinyinIsSuspect('zìxíng', '自行车')).toBe(true);
    expect(pinyinIsSuspect('zìxíngchē chē', '自行车')).toBe(true);
  });
});

describe('normalizeExtraction', () => {
  it('cleans the title and falls back to the number from the file names', () => {
    expect(draft.title).toBe('I mezzi di trasporto');
    expect(draft.number).toBe(4);
    expect(normalizeExtraction(ExtractionSchema.parse({ ...rawExtraction, title: '', number: 7 }), new Set()).title).toBe('Lezione 7');
  });

  it('fixes look-alikes, converts tone numbers, drops duplicates and entries without Chinese', () => {
    expect(draft.vocab.map((v) => v.hanzi)).toEqual(['公交车', '地铁', '坐', '骑', '自行车', '一点儿']);
    expect(draft.vocab[0]).toMatchObject({ pinyin: 'gōngjiāochē', meaning: 'autobus', known: false, suspect: false });
    expect(JSON.stringify(draft)).not.toContain(CART);
    expect(JSON.stringify(draft)).not.toContain(BIG);
  });

  it('flags words known from earlier lessons and pinyin to check', () => {
    expect(draft.vocab.filter((v) => v.known).map((v) => v.hanzi)).toEqual(['坐']);
    expect(draft.vocab.filter((v) => v.suspect).map((v) => v.hanzi)).toEqual(['骑', '自行车']);
    expect(draft.warnings.join(' ')).toContain('1 voci scartate');
    expect(draft.warnings.join(' ')).toContain('2 parole con pinyin da controllare');
  });

  it('keeps grammar points that say something, with clean examples', () => {
    expect(draft.grammar).toHaveLength(1);
    expect(draft.grammar[0]!.pattern).toContain('大');
    expect(draft.grammar[0]!.examples).toEqual([{ zh: '我坐地铁去学校。', pinyin: 'Wǒ zuò dìtiě qù xuéxiào.', it: 'Vado a scuola in metro.' }]);
  });

  it('keeps sentences with Chinese, once each', () => {
    expect(draft.sentences.map((s) => s.zh)).toEqual(['我坐地铁去学校。', '他坐公交车去。', '你怎么去学校？']);
    expect(draft.sentences.map((s) => s.source)).toEqual(['lezione', 'compiti', 'lezione']);
  });

  it('keeps a word list only when it rebuilds the sentence', () => {
    expect(draft.sentences[0]!.words).toEqual(['我', '坐', '地铁', '去', '学校']);
    expect(draft.sentences[1]!.words).toEqual(['他', '坐', '公交车', '去']); // look-alike and punctuation fixed
    expect(draft.sentences[2]!.words).toEqual([]); // a word was missing: no reorder exercise from this one
  });

  it('keeps fill-ins with exactly one blank, the answer among at least two options', () => {
    expect(draft.clozes.map((c) => c.text)).toEqual([`我${BLANK}地铁去学校。`, `他${BLANK}自行车去。`]);
    expect(draft.clozes[0]!.options).toEqual(['坐', '骑', '开']);
    expect(draft.clozes[1]!.options).toEqual(['骑', '坐']); // the answer was missing from the options: added
    for (const c of draft.clozes) expect(c.options).toContain(c.answer);
  });

  it('warns about look-alike characters it could not map', () => {
    const odd = cp(0x2e81);
    const withOdd = normalizeExtraction(ExtractionSchema.parse({ ...rawExtraction, summary: `strano ${odd}` }), new Set());
    expect(withOdd.warnings.join(' ')).toContain(odd);
  });
});

describe('normalizeGeneration', () => {
  it('cleans generated exercises and drops what the lesson already has', () => {
    const raw = GenerationSchema.parse({
      sentences: [
        { zh: '我坐地铁去学校', pinyin: 'x', it: 'già presente', words: [] },
        { zh: '她 骑 自行车 去 。', pinyin: 'Ta1 qi2 zi4xing2che1 qu4.', it: 'Lei va in bici.', words: ['她', '骑', '自行车', '去'] },
      ],
      clozes: [
        { text: `我${BLANK}地铁去学校。`, answer: '坐', options: ['坐', '骑'], translation: 'già presente', explanation: '' },
        { text: '她___自行车。', answer: '骑', options: ['骑', '坐', '开'], translation: 'Lei va in bici.', explanation: 'Con la bici si usa 骑.' },
      ],
    });
    const out = normalizeGeneration(raw, { sentences: ['我坐地铁去学校。'], clozes: [`我${BLANK}地铁去学校。`] });
    expect(out.sentences).toEqual([
      { zh: '她骑自行车去。', pinyin: 'Tā qí zìxíngchē qù.', it: 'Lei va in bici.', words: ['她', '骑', '自行车', '去'], source: 'ai' },
    ]);
    expect(out.clozes.map((c) => c.text)).toEqual([`她${BLANK}自行车。`]);
    expect(out.clozes[0]!.source).toBe('ai');
  });
});

describe('draftToBundle', () => {
  it('produces valid records, in order, with fresh ids', () => {
    const bundle = draftToBundle(draft, 'lesson-1', 1234, ['04 - Lezione 4.pdf']);
    expect(LessonSchema.safeParse(bundle.lesson).success).toBe(true);
    expect(bundle.lesson).toMatchObject({ id: 'lesson-1', number: 4, createdAt: 1234, files: ['04 - Lezione 4.pdf'] });
    for (const v of bundle.vocab) expect(VocabSchema.safeParse(v).success, v.hanzi).toBe(true);
    for (const g of bundle.grammar) expect(GrammarSchema.safeParse(g).success).toBe(true);
    for (const s of bundle.sentences) expect(SentenceSchema.safeParse(s).success, s.zh).toBe(true);
    for (const c of bundle.clozes) expect(ClozeSchema.safeParse(c).success, c.text).toBe(true);
    expect(bundle.vocab.map((v) => v.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bundle.vocab[0]).not.toHaveProperty('suspect');
    const ids = [...bundle.vocab, ...bundle.grammar, ...bundle.sentences, ...bundle.clozes].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(bundle.sentences.every((s) => s.lessonId === 'lesson-1' && s.acceptedZh.length === 0)).toBe(true);
  });
});

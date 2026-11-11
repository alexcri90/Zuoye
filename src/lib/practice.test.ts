import { describe, expect, it } from 'vitest';
import { emptySnapshot, type Snapshot } from './db.ts';
import { isPinyin } from './pinyin.ts';
import {
  buildQueue,
  combineEffort,
  counts,
  deriveCloze,
  exercisesFor,
  rateWriting,
  ratePinyin,
  wordsMatch,
  type QueueOptions,
} from './practice.ts';
import { SAMPLE_LESSON_ID, sampleLesson } from './sample.ts';
import { BLANK, ClozeSchema, GrammarSchema, LessonSchema, SentenceSchema, VocabSchema, type LessonBundle } from './schema.ts';
import { newCard, review, startOfDay } from './srs.ts';

const now = new Date(2026, 4, 12, 18, 0).getTime();

/** A repeatable random source. */
function seeded(seed = 7) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function dataWith(...bundles: LessonBundle[]): Snapshot {
  const data = emptySnapshot();
  for (const b of bundles) {
    data.lessons.push(b.lesson);
    data.vocab.push(...b.vocab);
    data.grammar.push(...b.grammar);
    data.sentences.push(...b.sentences);
    data.clozes.push(...b.clozes);
  }
  return data;
}

const sample = sampleLesson(now);
const data = dataWith(sample);
const options = (patch: Partial<QueueOptions>): QueueOptions => ({
  mode: 'pinyin',
  skills: ['pinyin', 'write'],
  lessons: [],
  size: 10,
  now,
  random: seeded(),
  ...patch,
});

describe('the built-in sample lesson', () => {
  it('is valid stored data', () => {
    expect(LessonSchema.safeParse(sample.lesson).success).toBe(true);
    for (const v of sample.vocab) expect(VocabSchema.safeParse(v).success, v.hanzi).toBe(true);
    for (const g of sample.grammar) expect(GrammarSchema.safeParse(g).success).toBe(true);
    for (const s of sample.sentences) expect(SentenceSchema.safeParse(s).success, s.zh).toBe(true);
    for (const c of sample.clozes) expect(ClozeSchema.safeParse(c).success).toBe(true);
  });

  it('has readable pinyin and word lists that match the sentences', () => {
    for (const v of sample.vocab) expect(isPinyin(v.pinyin), v.pinyin).toBe(true);
    for (const s of sample.sentences) expect(wordsMatch(s), s.zh).toBe(true);
  });
});

describe('exercisesFor', () => {
  it('makes every exercise type from a lesson', () => {
    const all = exercisesFor(data, [], seeded());
    const count = (skill: string) => all.filter((e) => e.skill === skill).length;
    expect(count('pinyin')).toBe(sample.vocab.length);
    expect(count('write')).toBe(sample.vocab.length);
    expect(count('it-zh')).toBe(sample.sentences.length);
    expect(count('zh-it')).toBe(sample.sentences.length);
    expect(count('order')).toBe(sample.sentences.length);
    // One stored fill-in, plus one derived from each sentence.
    expect(count('cloze')).toBe(1 + sample.sentences.length);
    expect(new Set(all.map((e) => e.key)).size).toBe(all.length);
  });

  it('skips what cannot be practised', () => {
    const odd = sampleLesson(now);
    odd.vocab = [
      { ...odd.vocab[0]!, id: 'x1', hanzi: 'OK', pinyin: 'ok' },
      { ...odd.vocab[0]!, id: 'x2', hanzi: '好', pinyin: '' },
      { ...odd.vocab[0]!, id: 'x3', hanzi: '一二三四五六七', pinyin: 'yī èr sān sì wǔ liù qī' },
    ];
    odd.sentences = [
      { ...odd.sentences[0]!, id: 'y1', it: '' },
      { ...odd.sentences[1]!, id: 'y2', words: ['她', '是'] },
    ];
    odd.clozes = [
      { ...odd.clozes[0]!, id: 'z1', text: '没有空格。' },
      { ...odd.clozes[0]!, id: 'z2', text: '我____也____。' },
    ];
    const keys = exercisesFor(dataWith(odd), [], seeded()).map((e) => e.key);
    // y1 has no translation but can still be reordered; y2 has too few words for that.
    expect(keys.sort()).toEqual(['it-zh:y2', 'order:y1', 'pinyin:x3', 'write:x2', 'zh-it:y2'].sort());
  });

  it('keeps to the chosen lessons, in lesson order', () => {
    const second = sampleLesson(now);
    second.lesson = { ...second.lesson, id: 'due', number: 2 };
    second.vocab = second.vocab.slice(0, 2).map((v, i) => ({ ...v, id: `due-v${i}`, lessonId: 'due' }));
    second.sentences = [];
    second.clozes = [];
    second.grammar = [];
    const both = dataWith(second, sample);
    expect(exercisesFor(both, ['due'], seeded()).every((e) => e.lessonId === 'due')).toBe(true);
    const pinyin = exercisesFor(both, [], seeded()).filter((e) => e.skill === 'pinyin');
    expect(pinyin[0]!.lessonId).toBe(SAMPLE_LESSON_ID);
    expect(pinyin.at(-1)!.lessonId).toBe('due');
  });
});

describe('deriveCloze', () => {
  it('hides one known word and offers it among wrong options', () => {
    for (const sentence of sample.sentences) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const cloze = deriveCloze(sentence, sample.vocab, () => 0, seeded(seed))!;
        expect(cloze, sentence.zh).not.toBeNull();
        expect(cloze.text.split(BLANK)).toHaveLength(2);
        expect(cloze.text.replace(BLANK, cloze.answer)).toBe(sentence.zh);
        expect(cloze.options).toContain(cloze.answer);
        expect(new Set(cloze.options).size).toBe(cloze.options.length);
        expect(cloze.options.length).toBeGreaterThanOrEqual(3);
        // No wrong option is another word of the same sentence.
        for (const o of cloze.options) if (o !== cloze.answer) expect(sentence.words).not.toContain(o);
        expect(sample.vocab.map((v) => v.hanzi)).toContain(cloze.answer);
      }
    }
  });

  it('prefers wrong options with the same part of speech', () => {
    const sentence = sample.sentences[2]!; // 我 喜欢 喝 茶
    const cloze = deriveCloze(sentence, sample.vocab, () => 0, () => 0.99)!; // hides the last known word: 茶 (N.)
    expect(cloze.answer).toBe('茶');
    const nouns = sample.vocab.filter((v) => v.pos === 'N.').map((v) => v.hanzi);
    for (const o of cloze.options) expect(nouns).toContain(o);
  });

  it('gives up when nothing can be hidden or there are too few other words', () => {
    const sentence = sample.sentences[0]!;
    expect(deriveCloze(sentence, [], () => 0, seeded())).toBeNull();
    expect(deriveCloze(sentence, sample.vocab.slice(3, 5), () => 0, seeded())).toBeNull();
    expect(deriveCloze({ ...sentence, words: ['我', '是'] }, sample.vocab, () => 0, seeded())).toBeNull();
    expect(deriveCloze({ ...sentence, words: ['我', '是', '老师'] }, sample.vocab, () => 0, seeded())).toBeNull();
  });
});

describe('buildQueue', () => {
  it('starts with new items in lesson order', () => {
    const queue = buildQueue(data, options({ size: 5 }));
    expect(queue.map((e) => e.key)).toEqual(sample.vocab.slice(0, 5).map((v) => `pinyin:${v.id}`));
  });

  it('puts due items before new ones, oldest first', () => {
    const cards = [
      { ...review(newCard(`pinyin:${sample.vocab[7]!.id}`), 'good', now - 86400000 * 2) },
      { ...review(newCard(`pinyin:${sample.vocab[9]!.id}`), 'good', now - 86400000 * 5) },
    ];
    const queue = buildQueue({ ...data, cards }, options({ size: 4 }));
    expect(queue.map((e) => e.itemId)).toEqual([sample.vocab[9]!.id, sample.vocab[7]!.id, sample.vocab[0]!.id, sample.vocab[1]!.id]);
  });

  it('leaves out items that are not due yet, unless asked for extra practice', () => {
    const cards = sample.vocab.map((v) => review(newCard(`pinyin:${v.id}`), 'good', now));
    expect(cards.every((c) => c.due === startOfDay(now, 1))).toBe(true);
    expect(buildQueue({ ...data, cards }, options({}))).toEqual([]);
    expect(buildQueue({ ...data, cards }, options({ extra: true }))).toHaveLength(10);
    // The next morning they are all due.
    expect(buildQueue({ ...data, cards }, options({ now: startOfDay(now, 1) + 3600000 }))).toHaveLength(10);
  });

  it('alternates exercise types in a mixed session and does not reuse a word', () => {
    const queue = buildQueue(data, options({ mode: 'mista', size: 8 }));
    expect(queue.map((e) => e.skill)).toEqual(['pinyin', 'write', 'pinyin', 'write', 'pinyin', 'write', 'pinyin', 'write']);
    expect(new Set(queue.map((e) => e.itemId)).size).toBe(8);
  });

  it('reuses words only when there is nothing else', () => {
    const queue = buildQueue(data, options({ mode: 'mista', size: 20 }));
    expect(queue).toHaveLength(20);
    expect(new Set(queue.map((e) => e.itemId)).size).toBe(sample.vocab.length);
    expect(new Set(queue.map((e) => e.key)).size).toBe(20);
  });

  it('draws a mixed session only from the enabled types', () => {
    const queue = buildQueue(data, options({ mode: 'mista', skills: ['order', 'cloze'], size: 6 }));
    expect(new Set(queue.map((e) => e.skill))).toEqual(new Set(['order', 'cloze']));
  });

  it('is empty when there are no lessons', () => {
    expect(buildQueue(emptySnapshot(), options({ mode: 'mista' }))).toEqual([]);
  });
});

describe('counts', () => {
  it('separates due, new and total', () => {
    const cards = [
      review(newCard(`pinyin:${sample.vocab[0]!.id}`), 'good', now - 86400000 * 3),
      review(newCard(`pinyin:${sample.vocab[1]!.id}`), 'good', now),
      review(newCard(`write:${sample.vocab[0]!.id}`), 'again', now - 1000),
    ];
    const c = counts({ ...data, cards }, [], now);
    expect(c.pinyin).toEqual({ due: 1, fresh: sample.vocab.length - 2, total: sample.vocab.length });
    expect(c.write).toEqual({ due: 1, fresh: sample.vocab.length - 1, total: sample.vocab.length });
    expect(c['it-zh'].total).toBe(sample.sentences.length);
  });
});

describe('ratings', () => {
  it('pinyin: only a fully correct answer passes', () => {
    expect(ratePinyin({ verdict: 'correct' })).toBe('good');
    expect(ratePinyin({ verdict: 'tones', wrong: [0], missing: false })).toBe('again');
    expect(ratePinyin({ verdict: 'wrong' })).toBe('again');
  });

  it('writing: the rating follows the help used', () => {
    const clean = { revealed: false, outlined: false, hinted: false, mistakes: 0, strokes: 8 };
    expect(rateWriting(clean)).toBe('good');
    expect(rateWriting({ ...clean, mistakes: 2 })).toBe('good');
    expect(rateWriting({ ...clean, mistakes: 3 })).toBe('hard');
    expect(rateWriting({ ...clean, strokes: 16, mistakes: 4 })).toBe('good');
    expect(rateWriting({ ...clean, hinted: true })).toBe('hard');
    expect(rateWriting({ ...clean, outlined: true })).toBe('hard');
    expect(rateWriting({ ...clean, outlined: true, revealed: true })).toBe('again');
  });

  it('writing: a word is rated on all its characters together', () => {
    const a = { revealed: false, outlined: false, hinted: false, mistakes: 1, strokes: 6 };
    const b = { revealed: false, outlined: true, hinted: false, mistakes: 0, strokes: 9 };
    expect(combineEffort([a, b])).toEqual({ revealed: false, outlined: true, hinted: false, mistakes: 1, strokes: 15 });
    expect(rateWriting(combineEffort([a, a]))).toBe('good');
    expect(rateWriting(combineEffort([a, b]))).toBe('hard');
  });
});

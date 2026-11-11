import { describe, expect, it } from 'vitest';
import {
  BackupSchema,
  CardSchema,
  ExtractionSchema,
  GenerationSchema,
  LIMITS,
  LessonPackSchema,
  SentenceSchema,
  VerdictSchema,
  VocabSchema,
} from './schema.ts';

describe('strict schemas', () => {
  const vocab = { id: 'v1', lessonId: 'l1', order: 0, hanzi: '朋友', pinyin: 'péngyou', meaning: 'amico', pos: 'N.', note: '' };

  it('accept a well-formed record', () => {
    expect(VocabSchema.parse(vocab)).toEqual(vocab);
  });

  it('reject missing fields, wrong types and oversized values', () => {
    expect(VocabSchema.safeParse({ ...vocab, hanzi: '' }).success).toBe(false);
    expect(VocabSchema.safeParse({ ...vocab, meaning: 12 }).success).toBe(false);
    expect(VocabSchema.safeParse({ ...vocab, hanzi: '字'.repeat(LIMITS.hanzi + 1) }).success).toBe(false);
    const { pinyin: _omitted, ...withoutPinyin } = vocab;
    expect(VocabSchema.safeParse(withoutPinyin).success).toBe(false);
  });

  it('reject an unknown sentence source and an over-long word list', () => {
    const sentence = {
      id: 's1',
      lessonId: 'l1',
      order: 0,
      zh: '我是学生。',
      pinyin: 'Wǒ shì xuésheng.',
      it: 'Sono uno studente.',
      words: ['我', '是', '学生'],
      source: 'lezione',
      acceptedZh: [],
      acceptedIt: [],
    };
    expect(SentenceSchema.safeParse(sentence).success).toBe(true);
    expect(SentenceSchema.safeParse({ ...sentence, source: 'web' }).success).toBe(false);
    expect(SentenceSchema.safeParse({ ...sentence, words: Array(LIMITS.words + 1).fill('我') }).success).toBe(false);
  });

  it('reject impossible cards', () => {
    const card = { key: 'pinyin:v1', due: 0, interval: 1, ease: 2.5, reps: 1, lapses: 0, last: 1 };
    expect(CardSchema.safeParse(card).success).toBe(true);
    expect(CardSchema.safeParse({ ...card, ease: 0 }).success).toBe(false);
    expect(CardSchema.safeParse({ ...card, interval: -1 }).success).toBe(false);
    expect(CardSchema.safeParse({ ...card, reps: 1.5 }).success).toBe(false);
  });

  it('accept only files written by this app', () => {
    const empty = { vocab: [], grammar: [], sentences: [], clozes: [] };
    const backup = { app: 'zuoye', kind: 'backup', version: 1, exportedAt: 1, lessons: [], cards: [], ...empty };
    expect(BackupSchema.safeParse(backup).success).toBe(true);
    expect(BackupSchema.safeParse({ ...backup, app: 'other' }).success).toBe(false);
    expect(BackupSchema.safeParse({ ...backup, version: 2 }).success).toBe(false);
    // A lesson pack is not a backup, and the other way round.
    expect(LessonPackSchema.safeParse(backup).success).toBe(false);
    expect(BackupSchema.safeParse({ ...backup, kind: 'lesson' }).success).toBe(false);
  });
});

describe('lenient schemas for model output', () => {
  it('fill in what is missing', () => {
    const out = ExtractionSchema.parse({ title: '  Lezione 3 ', vocab: [{ hanzi: '车' }] });
    expect(out.title).toBe('Lezione 3');
    expect(out.number).toBeUndefined();
    expect(out.summary).toBe('');
    expect(out.vocab).toEqual([{ hanzi: '车', pinyin: '', meaning: '', pos: '', note: '' }]);
    expect(out.grammar).toEqual([]);
    expect(out.sentences).toEqual([]);
    expect(out.clozes).toEqual([]);
  });

  it('cut strings and lists to size instead of failing', () => {
    const out = ExtractionSchema.parse({
      title: 'x'.repeat(5000),
      number: 99999,
      vocab: Array.from({ length: LIMITS.vocab + 50 }, () => ({ hanzi: '好', meaning: 'm'.repeat(9999) })),
      sentences: [{ zh: '你好', source: 'altro', words: null }],
    });
    expect(out.title).toHaveLength(LIMITS.short);
    expect(out.number).toBeNull();
    expect(out.vocab).toHaveLength(LIMITS.vocab);
    expect(out.vocab[0]!.meaning).toHaveLength(LIMITS.short);
    expect(out.sentences[0]).toMatchObject({ zh: '你好', source: 'lezione', words: [] });
  });

  it('still reject output of the wrong shape', () => {
    expect(ExtractionSchema.safeParse('testo').success).toBe(false);
    expect(ExtractionSchema.safeParse({ vocab: 'nessuno' }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ vocab: [{ hanzi: 5 }] }).success).toBe(false);
    expect(GenerationSchema.safeParse({ sentences: {} }).success).toBe(false);
  });

  it('validate a grading verdict and bound its score', () => {
    const out = VerdictSchema.parse({
      verdict: 'quasi',
      score: 140.6,
      corrected: '我是学生。',
      comment: 'Manca il verbo.',
      errors: [{ type: 'sconosciuto', detail: 'x' }],
    });
    expect(out.score).toBe(100);
    expect(out.correctedPinyin).toBe('');
    expect(out.errors).toEqual([{ type: 'grammatica', detail: 'x' }]);
    expect(VerdictSchema.safeParse({ verdict: 'forse', score: 50 }).success).toBe(false);
    expect(VerdictSchema.parse({ verdict: 'errata', score: 'alto' }).score).toBe(0);
  });
});

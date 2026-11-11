import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { cardItemId, newId, openDatabase, type Database } from './db.ts';
import type { LessonBundle } from './schema.ts';
import { newCard } from './srs.ts';

let counter = 0;
let open: Database | undefined;

async function freshDb(): Promise<Database> {
  open = await openDatabase(`test-${++counter}`);
  return open;
}

afterEach(() => {
  open?.close();
  open = undefined;
});

function bundle(lessonId: string, number: number): LessonBundle {
  const base = { lessonId, order: 0 };
  return {
    lesson: { id: lessonId, number, title: `Lezione ${number}`, summary: '', createdAt: number, files: ['a.pdf'] },
    vocab: [
      { ...base, id: `${lessonId}-v1`, hanzi: '朋友', pinyin: 'péngyou', meaning: 'amico', pos: 'N.', note: '' },
      { ...base, order: 1, id: `${lessonId}-v2`, hanzi: '喜欢', pinyin: 'xǐhuan', meaning: 'piacere', pos: 'V.', note: '' },
    ],
    grammar: [{ ...base, id: `${lessonId}-g1`, title: '也', pattern: 'S + 也 + V', explanation: 'anche', examples: [] }],
    sentences: [
      {
        ...base,
        id: `${lessonId}-s1`,
        zh: '我喜欢我的朋友。',
        pinyin: 'Wǒ xǐhuan wǒ de péngyou.',
        it: 'Mi piace il mio amico.',
        words: ['我', '喜欢', '我', '的', '朋友'],
        source: 'lezione',
        acceptedZh: [],
        acceptedIt: [],
      },
    ],
    clozes: [
      {
        ...base,
        id: `${lessonId}-c1`,
        text: '我____喜欢茶。',
        answer: '也',
        options: ['也', '的', '吗'],
        translation: 'Anche a me piace il tè.',
        explanation: '',
        source: 'compiti',
      },
    ],
  };
}

describe('database', () => {
  it('starts empty', async () => {
    const db = await freshDb();
    const snap = await db.snapshot();
    expect(snap).toEqual({ lessons: [], vocab: [], grammar: [], sentences: [], clozes: [], cards: [] });
  });

  it('saves a lesson with its content and reads it back, lessons in order', async () => {
    const db = await freshDb();
    await db.saveLesson(bundle('b', 2));
    await db.saveLesson(bundle('a', 1));
    const snap = await db.snapshot();
    expect(snap.lessons.map((l) => l.id)).toEqual(['a', 'b']);
    expect(snap.vocab).toHaveLength(4);
    expect(snap.sentences.find((s) => s.id === 'a-s1')).toEqual(bundle('a', 1).sentences[0]);
  });

  it('returns items in lesson order, whatever their ids', async () => {
    const db = await freshDb();
    const b = bundle('a', 1);
    // Ids that sort differently from the lesson order (as random ids do).
    b.vocab = ['v1', 'v10', 'v11', 'v2', 'v3'].map((suffix, i) => ({ ...b.vocab[0]!, id: `a-${suffix}`, order: 4 - i }));
    await db.saveLesson(b);
    expect((await db.snapshot()).vocab.map((v) => v.id)).toEqual(['a-v3', 'a-v2', 'a-v11', 'a-v10', 'a-v1']);
  });

  it('keeps progress and accepted answers', async () => {
    const db = await freshDb();
    const b = bundle('a', 1);
    await db.saveLesson(b);
    await db.putCard({ ...newCard('pinyin:a-v1'), reps: 2, last: 5 });
    await db.putSentence({ ...b.sentences[0]!, acceptedIt: ['Voglio bene al mio amico.'] });
    const snap = await db.snapshot();
    expect(snap.cards).toEqual([{ ...newCard('pinyin:a-v1'), reps: 2, last: 5 }]);
    expect(snap.sentences[0]!.acceptedIt).toEqual(['Voglio bene al mio amico.']);
  });

  it('adds generated exercises to a lesson', async () => {
    const db = await freshDb();
    const b = bundle('a', 1);
    await db.saveLesson(b);
    await db.addExercises([{ ...b.sentences[0]!, id: 'a-s2', source: 'ai' }], [{ ...b.clozes[0]!, id: 'a-c2', source: 'ai' }]);
    const snap = await db.snapshot();
    expect(snap.sentences.map((s) => s.id).sort()).toEqual(['a-s1', 'a-s2']);
    expect(snap.clozes.map((c) => c.id).sort()).toEqual(['a-c1', 'a-c2']);
  });

  it('deletes a lesson with its content and progress, and nothing else', async () => {
    const db = await freshDb();
    await db.saveLesson(bundle('a', 1));
    await db.saveLesson(bundle('b', 2));
    for (const key of ['pinyin:a-v1', 'write:a-v1', 'zh-it:a-s1', 'cloze:a-c1', 'pinyin:b-v1']) {
      await db.putCard({ ...newCard(key), last: 1 });
    }
    await db.deleteLesson('a');
    const snap = await db.snapshot();
    expect(snap.lessons.map((l) => l.id)).toEqual(['b']);
    expect(snap.vocab.every((v) => v.lessonId === 'b')).toBe(true);
    expect(snap.grammar).toHaveLength(1);
    expect(snap.sentences).toHaveLength(1);
    expect(snap.clozes).toHaveLength(1);
    expect(snap.cards.map((c) => c.key)).toEqual(['pinyin:b-v1']);
  });

  it('deletes a single item with its progress', async () => {
    const db = await freshDb();
    await db.saveLesson(bundle('a', 1));
    await db.putCard({ ...newCard('pinyin:a-v1'), last: 1 });
    await db.putCard({ ...newCard('pinyin:a-v2'), last: 1 });
    await db.deleteItem('vocab', 'a-v1');
    const snap = await db.snapshot();
    expect(snap.vocab.map((v) => v.id)).toEqual(['a-v2']);
    expect(snap.cards.map((c) => c.key)).toEqual(['pinyin:a-v2']);
  });

  it('replaces everything when restoring', async () => {
    const db = await freshDb();
    await db.saveLesson(bundle('a', 1));
    await db.putCard({ ...newCard('pinyin:a-v1'), last: 1 });
    const saved = await db.snapshot();
    await db.saveLesson(bundle('b', 2));
    await db.replaceAll(saved);
    expect(await db.snapshot()).toEqual(saved);
  });
});

describe('ids', () => {
  it('are random and safe to use in keys', () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{24}$/);
  });

  it('are recovered from a card key', () => {
    expect(cardItemId('it-zh:abc123')).toBe('abc123');
    expect(cardItemId('pinyin:a:b')).toBe('a:b');
  });
});

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ImportError, MAX_IMPORT_BYTES, exportFileName, makeBackup, makeLessonPack, parseImport } from './backup.ts';
import { emptySnapshot, openDatabase, type Snapshot } from './db.ts';
import { sampleLesson } from './sample.ts';
import { newCard, review } from './srs.ts';

const now = new Date(2026, 10, 13, 9, 30).getTime();

function sampleData(): Snapshot {
  const b = sampleLesson(now);
  const second = sampleLesson(now + 1);
  second.lesson = { ...second.lesson, id: 'due', number: 2, title: 'Seconda', files: ['02 - Lezione 2.pdf'] };
  const move = <T extends { id: string; lessonId: string }>(rows: T[]) => rows.map((r) => ({ ...r, id: `due-${r.id}`, lessonId: 'due' }));
  const data = emptySnapshot();
  data.lessons.push(b.lesson, second.lesson);
  data.vocab.push(...b.vocab, ...move(second.vocab));
  data.grammar.push(...b.grammar, ...move(second.grammar));
  data.sentences.push(...b.sentences, ...move(second.sentences));
  data.clozes.push(...b.clozes, ...move(second.clozes));
  data.sentences[0] = { ...data.sentences[0]!, acceptedIt: ['Sono studente.'] };
  data.cards.push(
    review(newCard(`pinyin:${b.vocab[0]!.id}`), 'good', now - 86400000 * 3),
    review(newCard(`write:${b.vocab[1]!.id}`), 'again', now),
    review(newCard(`zh-it:${b.sentences[0]!.id}`), 'hard', now),
    review(newCard(`cloze:due-${b.clozes[0]!.id}`), 'good', now),
  );
  return data;
}

const reject = (text: string): string => {
  try {
    parseImport(text);
    return 'accepted';
  } catch (error) {
    return error instanceof ImportError ? error.message : `other error: ${String(error)}`;
  }
};

describe('backup round trip', () => {
  it('restores an identical database', async () => {
    const source = await openDatabase('backup-source');
    await source.replaceAll(sampleData());
    const before = await source.snapshot();

    const file = JSON.stringify(makeBackup(before, now));
    const imported = parseImport(file);
    expect(imported.kind).toBe('backup');
    if (imported.kind !== 'backup') return;

    const target = await openDatabase('backup-target');
    await target.replaceAll(imported.data);
    expect(await target.snapshot()).toEqual(before);

    // And once more: exporting what was imported gives the same file content.
    expect(JSON.parse(JSON.stringify(makeBackup(await target.snapshot(), now)))).toEqual(JSON.parse(file));
    source.close();
    target.close();
  });

  it('survives an empty database', () => {
    const imported = parseImport(JSON.stringify(makeBackup(emptySnapshot(), now)));
    expect(imported).toEqual({ kind: 'backup', data: emptySnapshot() });
  });
});

describe('lesson pack', () => {
  const data = sampleData();

  it('holds one lesson, without progress, typed answers or file names', () => {
    const pack = makeLessonPack(data, 'due', now)!;
    expect(pack.lesson).toMatchObject({ id: 'due', title: 'Seconda', files: [] });
    expect(pack.vocab.every((v) => v.lessonId === 'due')).toBe(true);
    expect(pack.vocab).toHaveLength(data.vocab.length / 2);
    expect(pack).not.toHaveProperty('cards');
    const own = makeLessonPack(data, data.lessons[0]!.id, now)!;
    expect(own.sentences.every((s) => s.acceptedIt.length === 0 && s.acceptedZh.length === 0)).toBe(true);
  });

  it('is read back as a lesson bundle', () => {
    const pack = makeLessonPack(data, 'due', now)!;
    const imported = parseImport(JSON.stringify(pack));
    expect(imported.kind).toBe('lesson');
    if (imported.kind !== 'lesson') return;
    expect(imported.bundle.lesson.id).toBe('due');
    expect(imported.bundle.sentences).toEqual(pack.sentences);
  });

  it('does not exist for an unknown lesson', () => {
    expect(makeLessonPack(data, 'nessuna', now)).toBeNull();
  });
});

describe('untrusted files are refused', () => {
  const good = makeBackup(sampleData(), now);
  const pack = makeLessonPack(sampleData(), 'due', now)!;

  it('anything that is not ours', () => {
    expect(reject('non è json')).toContain('non è leggibile');
    expect(reject('null')).toContain('non è un file esportato');
    expect(reject('[1,2,3]')).toContain('non è un file esportato');
    expect(reject(JSON.stringify({ kind: 'altro' }))).toContain('non è un file esportato');
    expect(reject(JSON.stringify({ ...good, app: 'altra-app' }))).toContain('danneggiato');
    expect(reject(JSON.stringify({ ...good, version: 2 }))).toContain('non supportata');
  });

  it('files that are too large', () => {
    expect(reject(' '.repeat(MAX_IMPORT_BYTES + 1))).toContain('troppo grande');
  });

  it('records of the wrong shape or size', () => {
    const cases = [
      { ...good, vocab: [{ ...good.vocab[0], hanzi: '' }] },
      { ...good, vocab: [{ ...good.vocab[0], meaning: 'x'.repeat(100_000) }] },
      { ...good, vocab: [{ ...good.vocab[0], order: -1 }] },
      { ...good, sentences: [{ ...good.sentences[0], source: 'internet' }] },
      { ...good, cards: [{ ...good.cards[0], ease: 99 }] },
      { ...good, lessons: 'tutte' },
    ];
    for (const bad of cases) expect(reject(JSON.stringify(bad))).toContain('danneggiato');
  });

  it('inconsistent content', () => {
    expect(reject(JSON.stringify({ ...good, vocab: [{ ...good.vocab[0], lessonId: 'fantasma' }] }))).toContain('senza lezione');
    expect(reject(JSON.stringify({ ...good, vocab: [good.vocab[0], good.vocab[0]] }))).toContain('ripetuti');
    expect(reject(JSON.stringify({ ...good, lessons: [{ ...good.lessons[0], id: '../x' }] }))).toContain('non validi');
    expect(reject(JSON.stringify({ ...pack, vocab: [{ ...pack.vocab[0], lessonId: 'altra' }] }))).toContain('incoerente');
    expect(reject(JSON.stringify({ ...pack, lesson: { ...pack.lesson, id: 'a b' } }))).toContain('non validi');
  });

  it('progress on missing items is dropped, the rest is kept', () => {
    const extra = [
      { ...good.cards[0]!, key: 'pinyin:non-esiste' },
      { ...good.cards[0]!, key: 'volare:esempio-v1' },
      { ...good.cards[0]! },
    ];
    const imported = parseImport(JSON.stringify({ ...good, cards: [...good.cards, ...extra] }));
    expect(imported.kind === 'backup' && imported.data.cards).toEqual(good.cards);
  });

  it('unknown fields and prototype tricks do not get through', () => {
    const text = JSON.stringify({ ...good, extra: 'x' }).replace('"extra":"x"', '"__proto__":{"polluted":true},"extra":"x"');
    const imported = parseImport(text);
    expect(imported.kind).toBe('backup');
    expect(Object.keys(imported.kind === 'backup' ? imported.data : {}).sort()).toEqual(['cards', 'clozes', 'grammar', 'lessons', 'sentences', 'vocab']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const withMarkup = parseImport(JSON.stringify({ ...pack, lesson: { ...pack.lesson, title: '<img src=x onerror=alert(1)>' } }));
    // Markup is kept as plain text; the screens render text only.
    expect(withMarkup.kind === 'lesson' && withMarkup.bundle.lesson.title).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('exportFileName', () => {
  it('names files by kind and date', () => {
    expect(exportFileName('backup', now)).toBe('zuoye-backup-2026-11-13.json');
    expect(exportFileName('lezione', now, 3)).toBe('zuoye-lezione-3-2026-11-13.json');
    expect(exportFileName('lezione', now)).toBe('zuoye-lezione-2026-11-13.json');
  });
});

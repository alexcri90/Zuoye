/**
 * Moving data in and out as files: a full backup (lessons and progress) and
 * lesson packs (one processed lesson, no progress) to pass to classmates.
 * An imported file is untrusted: it is size-limited, validated against the
 * strict schemas, checked for consistency, and only then handed to the caller.
 */
import { cardItemId, type Snapshot } from './db.ts';
import { BackupSchema, LessonPackSchema, SKILLS, type Backup, type LessonBundle, type LessonPack } from './schema.ts';

export const MAX_IMPORT_BYTES = 30 * 1024 * 1024;

/** An import that was refused; the message is in Italian and can be shown as it is. */
export class ImportError extends Error {}

export function makeBackup(data: Snapshot, now: number): Backup {
  return { app: 'zuoye', kind: 'backup', version: 1, exportedAt: now, ...data };
}

/** One lesson without progress and without the answers its owner typed. */
export function makeLessonPack(data: Snapshot, lessonId: string, now: number): LessonPack | null {
  const lesson = data.lessons.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const mine = <T extends { lessonId: string }>(rows: readonly T[]) => rows.filter((r) => r.lessonId === lessonId);
  return {
    app: 'zuoye',
    kind: 'lesson',
    version: 1,
    exportedAt: now,
    lesson: { ...lesson, files: [] },
    vocab: mine(data.vocab),
    grammar: mine(data.grammar),
    sentences: mine(data.sentences).map((s) => ({ ...s, acceptedZh: [], acceptedIt: [] })),
    clozes: mine(data.clozes),
  };
}

export type Imported = { kind: 'backup'; data: Snapshot } | { kind: 'lesson'; bundle: LessonBundle };

const SAFE_ID = /^[\w-]{1,64}$/;

/** Ids end up in card keys and in the address bar: only plain ones are accepted, each used once. */
function checkIds(rows: ReadonlyArray<{ id: string }>): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!SAFE_ID.test(row.id) || seen.has(row.id)) throw new ImportError('Il file contiene identificativi non validi o ripetuti.');
    seen.add(row.id);
  }
}

/**
 * Reads the text of an exported file. Throws ImportError when the file is not
 * one of ours or is damaged.
 */
export function parseImport(text: string): Imported {
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError('Il file è troppo grande per essere un backup di Zuòyè.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('Il file non è leggibile: non è un file esportato da Zuòyè.');
  }
  const kind = typeof raw === 'object' && raw !== null && 'kind' in raw ? raw.kind : undefined;

  if (kind === 'lesson') {
    const parsed = LessonPackSchema.safeParse(raw);
    if (!parsed.success) throw new ImportError('Il pacchetto lezione è danneggiato o di una versione non supportata.');
    const { lesson, vocab, grammar, sentences, clozes } = parsed.data;
    const items = [...vocab, ...grammar, ...sentences, ...clozes];
    checkIds([lesson, ...items]);
    if (items.some((item) => item.lessonId !== lesson.id)) throw new ImportError('Il pacchetto lezione è incoerente.');
    return { kind: 'lesson', bundle: { lesson, vocab, grammar, sentences, clozes } };
  }

  if (kind === 'backup') {
    const parsed = BackupSchema.safeParse(raw);
    if (!parsed.success) throw new ImportError('Il backup è danneggiato o di una versione non supportata.');
    const { lessons, vocab, grammar, sentences, clozes, cards } = parsed.data;
    const items = [...vocab, ...grammar, ...sentences, ...clozes];
    checkIds(lessons);
    checkIds(items);
    const lessonIds = new Set(lessons.map((l) => l.id));
    if (items.some((item) => !lessonIds.has(item.lessonId))) throw new ImportError('Il backup è incoerente: contiene voci senza lezione.');
    // Progress on things that no longer exist is dropped, not refused.
    const itemIds = new Set(items.map((i) => i.id));
    const skills: readonly string[] = SKILLS;
    const seen = new Set<string>();
    const kept = cards.filter((card) => {
      const ok = skills.includes(card.key.slice(0, card.key.indexOf(':'))) && itemIds.has(cardItemId(card.key)) && !seen.has(card.key);
      seen.add(card.key);
      return ok;
    });
    return { kind: 'backup', data: { lessons, vocab, grammar, sentences, clozes, cards: kept } };
  }

  throw new ImportError('Questo non è un file esportato da Zuòyè.');
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function exportFileName(kind: 'backup' | 'lezione', now: number, lessonNumber = 0): string {
  const d = new Date(now);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return kind === 'backup' ? `zuoye-backup-${day}.json` : `zuoye-lezione-${lessonNumber > 0 ? `${lessonNumber}-` : ''}${day}.json`;
}

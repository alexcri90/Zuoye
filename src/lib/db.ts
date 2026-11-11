/**
 * Storage in the browser's IndexedDB. Lessons and progress never leave the device.
 * The data set is small (a course of lessons), so the app reads it whole with
 * `snapshot()` and writes through the few operations below.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Cloze, Grammar, Lesson, LessonBundle, Sentence, Vocab } from './schema.ts';
import type { Card } from './srs.ts';

interface Schema extends DBSchema {
  lessons: { key: string; value: Lesson };
  vocab: { key: string; value: Vocab; indexes: { lessonId: string } };
  grammar: { key: string; value: Grammar; indexes: { lessonId: string } };
  sentences: { key: string; value: Sentence; indexes: { lessonId: string } };
  clozes: { key: string; value: Cloze; indexes: { lessonId: string } };
  cards: { key: string; value: Card };
}

const ITEM_STORES = ['vocab', 'grammar', 'sentences', 'clozes'] as const;
export type ItemStore = (typeof ITEM_STORES)[number];
const ALL_STORES = ['lessons', ...ITEM_STORES, 'cards'] as const;

export interface Snapshot {
  lessons: Lesson[];
  vocab: Vocab[];
  grammar: Grammar[];
  sentences: Sentence[];
  clozes: Cloze[];
  cards: Card[];
}

export const emptySnapshot = (): Snapshot => ({ lessons: [], vocab: [], grammar: [], sentences: [], clozes: [], cards: [] });

/** A random identifier. Uses getRandomValues, which also works on plain http (local Wi-Fi). */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The item a card belongs to: the part of its key after the skill. */
export const cardItemId = (key: string): string => key.slice(key.indexOf(':') + 1);

export class Database {
  constructor(private readonly db: IDBPDatabase<Schema>) {}

  async snapshot(): Promise<Snapshot> {
    const tx = this.db.transaction(ALL_STORES, 'readonly');
    const [lessons, vocab, grammar, sentences, clozes, cards] = await Promise.all([
      tx.objectStore('lessons').getAll(),
      tx.objectStore('vocab').getAll(),
      tx.objectStore('grammar').getAll(),
      tx.objectStore('sentences').getAll(),
      tx.objectStore('clozes').getAll(),
      tx.objectStore('cards').getAll(),
    ]);
    await tx.done;
    lessons.sort((a, b) => a.number - b.number || a.createdAt - b.createdAt);
    // The database returns rows by id; the lesson's own order is what matters.
    for (const rows of [vocab, grammar, sentences, clozes]) rows.sort((a, b) => a.order - b.order);
    return { lessons, vocab, grammar, sentences, clozes, cards };
  }

  /** Saves a lesson and everything in it, all or nothing. */
  async saveLesson(bundle: LessonBundle): Promise<void> {
    const tx = this.db.transaction(['lessons', ...ITEM_STORES], 'readwrite');
    void tx.objectStore('lessons').put(bundle.lesson);
    for (const v of bundle.vocab) void tx.objectStore('vocab').put(v);
    for (const g of bundle.grammar) void tx.objectStore('grammar').put(g);
    for (const s of bundle.sentences) void tx.objectStore('sentences').put(s);
    for (const c of bundle.clozes) void tx.objectStore('clozes').put(c);
    await tx.done;
  }

  /** Adds generated exercises to an existing lesson. */
  async addExercises(sentences: Sentence[], clozes: Cloze[]): Promise<void> {
    const tx = this.db.transaction(['sentences', 'clozes'], 'readwrite');
    for (const s of sentences) void tx.objectStore('sentences').put(s);
    for (const c of clozes) void tx.objectStore('clozes').put(c);
    await tx.done;
  }

  async putSentence(sentence: Sentence): Promise<void> {
    await this.db.put('sentences', sentence);
  }

  async putCard(card: Card): Promise<void> {
    await this.db.put('cards', card);
  }

  /** Removes one word, sentence, grammar point or exercise, with its progress. */
  async deleteItem(store: ItemStore, id: string): Promise<void> {
    const tx = this.db.transaction([store, 'cards'], 'readwrite');
    void tx.objectStore(store).delete(id);
    await this.deleteCardsOf(tx.objectStore('cards'), new Set([id]));
    await tx.done;
  }

  /** Removes a lesson, its content and the progress made on it. */
  async deleteLesson(lessonId: string): Promise<void> {
    const tx = this.db.transaction(ALL_STORES, 'readwrite');
    const removed = new Set<string>();
    for (const name of ITEM_STORES) {
      const store = tx.objectStore(name);
      for (const key of await store.index('lessonId').getAllKeys(lessonId)) {
        removed.add(key);
        void store.delete(key);
      }
    }
    void tx.objectStore('lessons').delete(lessonId);
    await this.deleteCardsOf(tx.objectStore('cards'), removed);
    await tx.done;
  }

  /** Replaces everything (restoring a backup). */
  async replaceAll(data: Snapshot): Promise<void> {
    const tx = this.db.transaction(ALL_STORES, 'readwrite');
    for (const name of ALL_STORES) void tx.objectStore(name).clear();
    for (const l of data.lessons) void tx.objectStore('lessons').put(l);
    for (const v of data.vocab) void tx.objectStore('vocab').put(v);
    for (const g of data.grammar) void tx.objectStore('grammar').put(g);
    for (const s of data.sentences) void tx.objectStore('sentences').put(s);
    for (const c of data.clozes) void tx.objectStore('clozes').put(c);
    for (const c of data.cards) void tx.objectStore('cards').put(c);
    await tx.done;
  }

  close(): void {
    this.db.close();
  }

  private async deleteCardsOf(
    cards: { getAllKeys(): Promise<string[]>; delete(key: string): Promise<void> },
    itemIds: ReadonlySet<string>,
  ): Promise<void> {
    if (itemIds.size === 0) return;
    for (const key of await cards.getAllKeys()) {
      if (itemIds.has(cardItemId(key))) void cards.delete(key);
    }
  }
}

export async function openDatabase(name = 'zuoye'): Promise<Database> {
  const db = await openDB<Schema>(name, 1, {
    upgrade(database) {
      database.createObjectStore('lessons', { keyPath: 'id' });
      for (const store of ITEM_STORES) {
        database.createObjectStore(store, { keyPath: 'id' }).createIndex('lessonId', 'lessonId');
      }
      database.createObjectStore('cards', { keyPath: 'key' });
    },
  });
  return new Database(db);
}

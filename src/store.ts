/** What every screen can reach: the stored data and the preferences. */
import { createContext, use } from 'react';
import type { Database, Snapshot } from './lib/db.ts';
import type { Sentence } from './lib/schema.ts';
import type { Prefs } from './lib/settings.ts';
import type { Card } from './lib/srs.ts';

export interface Store {
  db: Database;
  /** Everything stored, as last read. */
  data: Snapshot;
  prefs: Prefs;
  /** Reads the data again after a change. */
  refresh: () => Promise<void>;
  saveCard: (card: Card) => Promise<void>;
  /** Stores a sentence again (for example with one more accepted answer). */
  saveSentence: (sentence: Sentence) => Promise<void>;
  setPrefs: (patch: Partial<Prefs>) => void;
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = use(StoreContext);
  if (!store) throw new Error('StoreContext is missing');
  return store;
}

/**
 * API key and preferences, kept in the browser's local storage on this device.
 * The key is never logged, never put in a URL and never leaves the device
 * except in the request header sent to the model provider.
 */
import { z } from 'zod';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY_ITEM = 'zuoye.apiKey';
const PREFS_ITEM = 'zuoye.prefs';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

/** Model names end up in a URL path, so only plain names are accepted. */
const MODEL_NAME = /^[a-z0-9][a-z0-9.-]{2,59}$/;
const modelName = (fallback: string) => z.string().regex(MODEL_NAME).catch(fallback);

/** How forgiving the stroke recognition of the writing exercise is. */
export const STROKE_LEVELS = ['precisa', 'normale', 'tollerante'] as const;
export type StrokeLevel = (typeof STROKE_LEVELS)[number];

/** The two looks of the app; 'essenziale' is the original one. */
export const THEMES = ['essenziale', 'nuovo'] as const;
export type Theme = (typeof THEMES)[number];

const PrefsSchema = z.object({
  strokes: z.enum(STROKE_LEVELS).catch('normale'),
  theme: z.enum(THEMES).catch('nuovo'),
  model: modelName(DEFAULT_MODEL),
  fallbackModel: modelName(DEFAULT_FALLBACK_MODEL),
  /** Items per practice session. */
  sessionSize: z.number().int().min(5).max(50).catch(10),
  /** Lessons to practise; empty means all. */
  lessons: z.array(z.string().max(64)).max(300).catch([]),
});

export type Prefs = z.infer<typeof PrefsSchema>;

export const isModelName = (name: string): boolean => MODEL_NAME.test(name);

function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage disabled in this browser
  }
}

function read(item: string, store: Store | null): string | null {
  try {
    return store?.getItem(item) ?? null;
  } catch {
    return null;
  }
}

function write(item: string, value: string | null, store: Store | null): boolean {
  try {
    if (!store) return false;
    if (value === null) store.removeItem(item);
    else store.setItem(item, value);
    return true;
  } catch {
    return false;
  }
}

/** A key is a short run of printable ASCII without spaces. */
const KEY_SHAPE = /^[\x21-\x7e]{20,200}$/;

export const looksLikeApiKey = (value: string): boolean => KEY_SHAPE.test(value.trim());

export function getApiKey(store: Store | null = defaultStore()): string {
  const value = read(KEY_ITEM, store) ?? '';
  return KEY_SHAPE.test(value) ? value : '';
}

/** Stores the key. Returns false when it does not look like a key or cannot be stored. */
export function setApiKey(value: string, store: Store | null = defaultStore()): boolean {
  const key = value.trim();
  return KEY_SHAPE.test(key) && write(KEY_ITEM, key, store);
}

export function clearApiKey(store: Store | null = defaultStore()): void {
  write(KEY_ITEM, null, store);
}

/** For display: only the last four characters. */
export function maskKey(key: string): string {
  return key.length < 8 ? '' : `•••• ${key.slice(-4)}`;
}

const USAGE_ITEM = 'zuoye.usage';

const dayOf = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** Requests sent to the model today (the free tier has a small daily budget). */
export function requestsToday(now: number, store: Store | null = defaultStore()): number {
  try {
    const usage = JSON.parse(read(USAGE_ITEM, store) ?? '{}') as { day?: unknown; count?: unknown };
    return usage.day === dayOf(now) && typeof usage.count === 'number' ? usage.count : 0;
  } catch {
    return 0;
  }
}

export function countRequest(now: number, store: Store | null = defaultStore()): void {
  write(USAGE_ITEM, JSON.stringify({ day: dayOf(now), count: requestsToday(now, store) + 1 }), store);
}

export function loadPrefs(store: Store | null = defaultStore()): Prefs {
  let raw: unknown = {};
  try {
    raw = JSON.parse(read(PREFS_ITEM, store) ?? '{}');
  } catch {
    raw = {};
  }
  const parsed = PrefsSchema.safeParse(raw);
  return parsed.success ? parsed.data : PrefsSchema.parse({});
}

export function savePrefs(patch: Partial<Prefs>, store: Store | null = defaultStore()): Prefs {
  const next = PrefsSchema.parse({ ...loadPrefs(store), ...patch });
  write(PREFS_ITEM, JSON.stringify(next), store);
  return next;
}

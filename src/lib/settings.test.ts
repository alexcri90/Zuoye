import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_MODEL,
  clearApiKey,
  getApiKey,
  isModelName,
  loadPrefs,
  looksLikeApiKey,
  maskKey,
  savePrefs,
  setApiKey,
} from './settings.ts';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

// Made up for the tests: the right shape, not a real key.
const FAKE_KEY = 'TEST-ONLY-not-a-real-key-0123456789';

describe('api key', () => {
  it('is stored trimmed and read back', () => {
    const store = memoryStore();
    expect(getApiKey(store)).toBe('');
    expect(setApiKey(`  ${FAKE_KEY}\n`, store)).toBe(true);
    expect(getApiKey(store)).toBe(FAKE_KEY);
  });

  it('is refused when it does not look like a key', () => {
    const store = memoryStore();
    for (const bad of ['', 'short', 'has spaces inside the key value', 'chiave con àccenti lunga abbastanza', 'x'.repeat(500)]) {
      expect(setApiKey(bad, store), bad).toBe(false);
      expect(looksLikeApiKey(bad)).toBe(false);
    }
    expect(store.data.size).toBe(0);
  });

  it('can be deleted', () => {
    const store = memoryStore();
    setApiKey(FAKE_KEY, store);
    clearApiKey(store);
    expect(getApiKey(store)).toBe('');
    expect(store.data.size).toBe(0);
  });

  it('is shown masked', () => {
    expect(maskKey(FAKE_KEY)).toMatch(/6789$/);
    expect(maskKey(FAKE_KEY)).not.toContain('TEST');
    expect(maskKey('')).toBe('');
  });

  it('survives a browser without storage', () => {
    expect(getApiKey(null)).toBe('');
    expect(setApiKey(FAKE_KEY, null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(getApiKey(broken)).toBe('');
    expect(setApiKey(FAKE_KEY, broken)).toBe(false);
    expect(() => clearApiKey(broken)).not.toThrow();
  });
});

describe('preferences', () => {
  it('have defaults', () => {
    expect(loadPrefs(memoryStore())).toEqual({
      strokes: 'normale',
      theme: 'nuovo',
      model: DEFAULT_MODEL,
      fallbackModel: DEFAULT_FALLBACK_MODEL,
      sessionSize: 10,
      lessons: [],
    });
  });

  it('are saved and merged', () => {
    const store = memoryStore();
    savePrefs({ sessionSize: 20 }, store);
    savePrefs({ lessons: ['a', 'b'] }, store);
    expect(loadPrefs(store)).toMatchObject({ sessionSize: 20, lessons: ['a', 'b'], model: DEFAULT_MODEL });
  });

  it('fall back to defaults when the stored value is damaged or hostile', () => {
    const store = memoryStore();
    store.setItem('zuoye.prefs', '{not json');
    expect(loadPrefs(store).sessionSize).toBe(10);
    store.setItem('zuoye.prefs', JSON.stringify({ model: '../../evil?x=', sessionSize: 9999, lessons: 'tutte', strokes: 'qualsiasi', theme: 7 }));
    expect(loadPrefs(store)).toEqual({
      strokes: 'normale',
      theme: 'nuovo',
      model: DEFAULT_MODEL,
      fallbackModel: DEFAULT_FALLBACK_MODEL,
      sessionSize: 10,
      lessons: [],
    });
  });

  it('remember the stroke tolerance and the look', () => {
    const store = memoryStore();
    savePrefs({ strokes: 'tollerante', theme: 'essenziale' }, store);
    expect(loadPrefs(store)).toMatchObject({ strokes: 'tollerante', theme: 'essenziale' });
  });

  it('accept only plain model names', () => {
    expect(isModelName('gemini-3.8-flash')).toBe(true);
    expect(isModelName('models/gemini')).toBe(false);
    expect(isModelName('gemini:generateContent?key=x')).toBe(false);
    expect(isModelName('')).toBe(false);
  });
});

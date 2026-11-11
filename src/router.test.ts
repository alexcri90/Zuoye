import { describe, expect, it } from 'vitest';
import { parseRoute } from './router.ts';

describe('parseRoute', () => {
  it('reads the known routes', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/lessons')).toEqual({ name: 'lessons' });
    expect(parseRoute('#/lessons/new')).toEqual({ name: 'lesson-new' });
    expect(parseRoute('#/lessons/abc123')).toEqual({ name: 'lesson', id: 'abc123' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/practice/pinyin')).toEqual({ name: 'practice', mode: 'pinyin', extra: false });
    expect(parseRoute('#/practice/mista?extra=1')).toEqual({ name: 'practice', mode: 'mista', extra: true });
    expect(parseRoute('#/practice/it-zh')).toEqual({ name: 'practice', mode: 'it-zh', extra: false });
  });

  it('falls back safely on anything else', () => {
    expect(parseRoute('#/practice/unknown')).toEqual({ name: 'home' });
    expect(parseRoute('#/practice')).toEqual({ name: 'home' });
    expect(parseRoute('#/nowhere')).toEqual({ name: 'home' });
    expect(parseRoute('#/lessons/<script>')).toEqual({ name: 'lessons' });
    expect(parseRoute('#/lessons/a%2Fb')).toEqual({ name: 'lessons' });
  });
});

import { describe, expect, it } from 'vitest';
import { compactIt, compactZh, hanChars, hasHan, normalizeHan, strokeFile, unmappedRadicals } from './hanzi.ts';

const cp = (n: number) => String.fromCodePoint(n);

describe('normalizeHan', () => {
  it('maps the Kangxi radicals found in the slides to real characters', () => {
    const pairs: Array<[number, string]> = [
      [0x2f00, '一'],
      [0x2f06, '二'],
      [0x2f08, '人'],
      [0x2f12, '力'],
      [0x2f24, '大'],
      [0x2f26, '子'],
      [0x2f29, '小'],
      [0x2f42, '文'],
      [0x2f47, '日'],
      [0x2f49, '月'],
      [0x2f54, '水'],
      [0x2f63, '生'],
      [0x2fbc, '高'],
    ];
    for (const [radical, char] of pairs) expect(normalizeHan(cp(radical)), radical.toString(16)).toBe(char);
  });

  it('maps the simplified radicals that have no standard mapping', () => {
    const pairs: Array<[number, string]> = [
      [0x2ec5, '见'],
      [0x2ecb, '车'],
      [0x2ed3, '长'],
      [0x2edc, '飞'],
      [0x2ee2, '马'],
      [0x2ee5, '鱼'],
      [0x2ec9, '贝'],
      [0x2ed4, '门'],
      [0x2eda, '页'],
      [0x2edb, '风'],
      [0x2edd, '食'],
      [0x2ee6, '鸟'],
      [0x2ef0, '龙'],
      [0x2eec, '齐'],
      [0x2eee, '齿'],
      [0x2ee8, '麦'],
      [0x2ee9, '黄'],
      [0x2ec6, '角'],
      [0x2ed8, '青'],
      [0x2ed9, '韦'],
      [0x2ee3, '骨'],
      [0x2ee4, '鬼'],
      [0x2ec4, '西'],
      [0x2ea0, '民'],
    ];
    for (const [radical, char] of pairs) expect(normalizeHan(cp(radical)), radical.toString(16)).toBe(char);
  });

  it('fixes a word made of look-alikes and leaves the rest alone', () => {
    expect(normalizeHan(`公交${cp(0x2ecb)}`)).toBe('公交车');
    expect(normalizeHan(`再${cp(0x2ec5)}！`)).toBe('再见！');
    expect(normalizeHan('你好，老师：ABC １２')).toBe('你好，老师：ABC １２');
  });

  it('reports look-alikes it cannot map', () => {
    expect(unmappedRadicals(`${cp(0x2ecb)}${cp(0x2f24)}`)).toEqual([]);
    expect(unmappedRadicals(cp(0x2e81))).toEqual([cp(0x2e81)]);
  });
});

describe('character helpers', () => {
  it('finds Chinese characters', () => {
    expect(hasHan('ciao')).toBe(false);
    expect(hasHan('ciao 你')).toBe(true);
    expect(hanChars('我 (wǒ) 是，学生!')).toEqual(['我', '是', '学', '生']);
  });

  it('names stroke files by code point', () => {
    expect(strokeFile('你')).toBe('4f60.json');
    expect(strokeFile('一')).toBe('4e00.json');
  });

  it('compares Chinese answers without punctuation, spaces or look-alikes', () => {
    expect(compactZh('你好！ 我是学生。')).toBe('你好我是学生');
    expect(compactZh('你好,我是学生')).toBe(compactZh('你好，我是 学生。'));
    expect(compactZh(`再${cp(0x2ec5)}`)).toBe('再见');
    expect(compactZh('我有３本书')).toBe('我有3本书');
  });

  it('compares Italian answers without case, accents or punctuation', () => {
    expect(compactIt('Perché non vieni?')).toBe('perche non vieni');
    expect(compactIt("  L'autobus è   arrivato! ")).toBe('l autobus e arrivato');
    expect(compactIt('l’autobus e arrivato')).toBe('l autobus e arrivato');
  });
});

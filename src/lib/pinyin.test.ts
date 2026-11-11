import { describe, expect, it } from 'vitest';
import { applyTone, gradePinyin, isPinyin, normalizePinyin, numbersToMarks, syllablesOf } from './pinyin.ts';

const ok = { verdict: 'correct' };

describe('gradePinyin: input styles', () => {
  it('accepts tone marks, numbers, and any spacing', () => {
    for (const answer of ['nǐ hǎo', 'nǐhǎo', 'ni3 hao3', 'ni3hao3', 'Ni3 Hao3', '  nǐ  hǎo ']) {
      expect(gradePinyin(answer, 'nǐ hǎo', '你好'), answer).toEqual(ok);
    }
  });

  it('accepts v, u: and ü for the same vowel', () => {
    for (const answer of ['lv4', 'lü4', 'lu:4', 'lǜ']) {
      expect(gradePinyin(answer, 'lǜ', '绿'), answer).toEqual(ok);
    }
    expect(gradePinyin('nv3 er2', "nǚ'ér", '女儿')).toEqual(ok);
    expect(gradePinyin('lve4', 'lüè')).toEqual(ok);
    expect(gradePinyin('lue4', 'lüè')).toEqual(ok);
    expect(gradePinyin('jv2', 'jú')).toEqual(ok);
  });

  it('treats an empty answer as empty, not wrong', () => {
    expect(gradePinyin('   ', 'hǎo')).toEqual({ verdict: 'empty' });
  });

  it('accepts a breve typed for the third tone', () => {
    expect(gradePinyin('hăo', 'hǎo')).toEqual(ok);
  });
});

describe('gradePinyin: syllables and tones', () => {
  it('reports wrong syllables', () => {
    expect(gradePinyin('ni3 hou3', 'nǐ hǎo')).toEqual({ verdict: 'wrong' });
    expect(gradePinyin('hao3', 'nǐ hǎo')).toEqual({ verdict: 'wrong' });
  });

  it('reports which syllable has the wrong tone', () => {
    expect(gradePinyin('ni3 hao4', 'nǐ hǎo')).toEqual({ verdict: 'tones', wrong: [1], missing: false });
    expect(gradePinyin('ni2 hao4', 'nǐ hǎo')).toEqual({ verdict: 'tones', wrong: [0, 1], missing: false });
  });

  it('treats a missing tone as an error and says so', () => {
    expect(gradePinyin('ni hao', 'nǐ hǎo')).toEqual({ verdict: 'tones', wrong: [0, 1], missing: true });
    expect(gradePinyin('ni3 hao', 'nǐ hǎo')).toEqual({ verdict: 'tones', wrong: [1], missing: true });
    expect(gradePinyin('ni2 hao', 'nǐ hǎo')).toEqual({ verdict: 'tones', wrong: [0, 1], missing: false });
  });

  it('does not depend on how the answer is split into syllables', () => {
    expect(gradePinyin('fan1 an4', 'fāngàn')).toEqual({ verdict: 'wrong' });
    expect(gradePinyin('fang1an4', "fāng'àn", '方案')).toEqual(ok);
    expect(gradePinyin('fāngàn', "fāng'àn", '方案')).toEqual(ok);
    expect(gradePinyin('xi1an1', "Xī'ān", '西安')).toEqual(ok);
    expect(gradePinyin('xīān', "Xī'ān", '西安')).toEqual(ok);
    expect(gradePinyin('xian1', 'xiān', '先')).toEqual(ok);
  });

  it('keeps one-syllable and two-syllable readings apart', () => {
    // 先 is one syllable: two tones on it cannot be right.
    expect(gradePinyin('xi1an1', 'xiān', '先').verdict).toBe('tones');
    // 西安 is two syllables: one tone is not enough.
    expect(gradePinyin('xian1', "Xī'ān", '西安').verdict).toBe('tones');
  });

  it('uses the characters to split an ambiguous expected reading', () => {
    // Written without the apostrophe, as slides often do.
    expect(gradePinyin('ke3 ai4', 'kěài', '可爱')).toEqual(ok);
    expect(gradePinyin('xi1 an1', 'xīān', '西安')).toEqual(ok);
  });
});

describe('gradePinyin: leniency found in the course materials', () => {
  it('accepts any tone where the lesson writes a neutral tone', () => {
    // The same course writes both xuésheng and xuéshēng.
    expect(gradePinyin('xue2sheng1', 'xuésheng', '学生')).toEqual(ok);
    expect(gradePinyin('xue2sheng', 'xuésheng', '学生')).toEqual(ok);
    expect(gradePinyin('xue2sheng5', 'xuésheng', '学生')).toEqual(ok);
    expect(gradePinyin('peng2you3', 'péngyou', '朋友')).toEqual(ok);
  });

  it('still wants the tone where the lesson writes one', () => {
    expect(gradePinyin('xue2sheng', 'xuéshēng', '学生')).toEqual({ verdict: 'tones', wrong: [1], missing: true });
    expect(gradePinyin('xue2sheng5', 'xuéshēng', '学生')).toEqual({ verdict: 'tones', wrong: [1], missing: false });
  });

  it('accepts dictionary and sandhi tones for 不', () => {
    expect(gradePinyin('bu4 rang4', 'bú ràng', '不让')).toEqual(ok);
    expect(gradePinyin('bu2 rang4', 'bú ràng', '不让')).toEqual(ok);
    expect(gradePinyin('bu2 rang4', 'bù ràng', '不让')).toEqual(ok);
    expect(gradePinyin('bu4 hao3', 'bù hǎo', '不好')).toEqual(ok);
    // No sandhi before a third tone.
    expect(gradePinyin('bu2 hao3', 'bù hǎo', '不好').verdict).toBe('tones');
    expect(gradePinyin('bu3 rang4', 'bú ràng', '不让').verdict).toBe('tones');
    expect(gradePinyin('dui4bu5qi3', 'duìbùqǐ', '对不起')).toEqual(ok);
  });

  it('accepts dictionary and sandhi tones for 一', () => {
    expect(gradePinyin('yi1 jian1', 'yì jiān', '一间')).toEqual(ok);
    expect(gradePinyin('yi4 jian1', 'yì jiān', '一间')).toEqual(ok);
    expect(gradePinyin('yi4qian1', 'yīqiān', '一千')).toEqual(ok);
    expect(gradePinyin('yi1qian1', 'yīqiān', '一千')).toEqual(ok);
    expect(gradePinyin('yi2 ge4', 'yí gè', '一个')).toEqual(ok);
    expect(gradePinyin('yi2 ge', 'yí ge', '一个')).toEqual(ok);
    // Second tone only before a fourth tone.
    expect(gradePinyin('yi2 jian1', 'yì jiān', '一间').verdict).toBe('tones');
    expect(gradePinyin('yi3 jian1', 'yì jiān', '一间').verdict).toBe('tones');
  });

  it('applies that leniency only to 一 and 不 themselves', () => {
    expect(gradePinyin('yi4 fu', 'yīfu', '衣服').verdict).toBe('tones');
    expect(gradePinyin('bu2 gao4', 'bùgào', '布告').verdict).toBe('tones');
    // Without the characters there is nothing to line up, so the written tone rules.
    expect(gradePinyin('bu4 rang4', 'bú ràng').verdict).toBe('tones');
  });

  it('accepts either of two readings separated by a slash', () => {
    expect(gradePinyin('shei2', 'shéi / shuí', '谁')).toEqual(ok);
    expect(gradePinyin('shui2', 'shéi / shuí', '谁')).toEqual(ok);
    expect(gradePinyin('shui3', 'shéi / shuí', '谁')).toEqual({ verdict: 'tones', wrong: [0], missing: false });
  });

  it('handles erhua, joined or spelt out', () => {
    expect(gradePinyin('wanr2', 'wánr', '玩儿')).toEqual(ok);
    expect(gradePinyin('wan2r', 'wánr', '玩儿')).toEqual(ok);
    expect(gradePinyin('wan2 er', 'wánr', '玩儿')).toEqual(ok);
    expect(gradePinyin('yi4dian3r', 'yìdiǎnr', '一点儿')).toEqual(ok);
    expect(gradePinyin('yi1dian3r', 'yìdiǎnr', '一点儿')).toEqual(ok);
    expect(gradePinyin('na3r', 'nǎr', '哪儿')).toEqual(ok);
    expect(gradePinyin('na4r', 'nǎr', '哪儿').verdict).toBe('tones');
    expect(gradePinyin('er2zi', 'érzi', '儿子')).toEqual(ok);
  });
});

describe('tone numbers to tone marks', () => {
  it('converts whole words', () => {
    expect(numbersToMarks('ni3 hao3')).toBe('nǐ hǎo');
    expect(numbersToMarks('ni3hao3')).toBe('nǐhǎo');
    expect(numbersToMarks('gong1jiao1che1')).toBe('gōngjiāochē');
    expect(numbersToMarks('Zhong1guo2')).toBe('Zhōngguó');
  });

  it('places the mark on the right vowel', () => {
    const cases: Array<[string, string]> = [
      ['hao3', 'hǎo'],
      ['xue2', 'xué'],
      ['gui4', 'guì'],
      ['liu2', 'liú'],
      ['dou1', 'dōu'],
      ['xiong2', 'xióng'],
      ['yuan4', 'yuàn'],
      ['jun1', 'jūn'],
      ['lv4', 'lǜ'],
      ['nv3', 'nǚ'],
      ['lve4', 'lüè'],
    ];
    for (const [typed, marked] of cases) expect(numbersToMarks(typed), typed).toBe(marked);
  });

  it('drops the digit of a neutral tone and leaves other digits alone', () => {
    expect(numbersToMarks('ma5')).toBe('ma');
    expect(numbersToMarks('de0')).toBe('de');
    expect(numbersToMarks('3 ge')).toBe('3 ge');
    expect(numbersToMarks('xq3')).toBe('xq3');
  });

  it('applies a tone to the last syllable, replacing an earlier one', () => {
    expect(applyTone('nihao', 3)).toBe('nihǎo');
    expect(applyTone('nǐhao', 3)).toBe('nǐhǎo');
    expect(applyTone('hǎo', 2)).toBe('háo');
    expect(applyTone('hǎo', 0)).toBe('hao');
    expect(applyTone('wanr', 2)).toBe('wánr');
    expect(applyTone('', 1)).toBeNull();
    expect(applyTone('ni3 ', 1)).toBeNull();
  });
});

describe('helpers', () => {
  it('normalises pinyin taken from a lesson', () => {
    expect(normalizePinyin('  nĭ   hăo ')).toBe('nǐ hǎo');
    expect(normalizePinyin('ni3 hao3')).toBe('nǐ hǎo');
    expect(normalizePinyin('gōngjiāochē')).toBe('gōngjiāochē');
  });

  it('lists the expected syllables with their marks', () => {
    expect(syllablesOf('nǐ hǎo', '你好')).toEqual(['nǐ', 'hǎo']);
    expect(syllablesOf('gōngjiāochē', '公交车')).toEqual(['gōng', 'jiāo', 'chē']);
    expect(syllablesOf('xuésheng', '学生')).toEqual(['xué', 'sheng']);
    expect(syllablesOf('wánr', '玩儿')).toEqual(['wánr']);
    expect(syllablesOf('shéi / shuí', '谁')).toEqual(['shéi']);
  });

  it('recognises pinyin', () => {
    expect(isPinyin('gōngjiāochē')).toBe(true);
    expect(isPinyin('zhuang4')).toBe(true);
    expect(isPinyin('autobus')).toBe(false);
    expect(isPinyin('(N.)')).toBe(false);
    expect(isPinyin('公交车')).toBe(false);
  });
});

/**
 * A small built-in lesson for trying the app before importing real material.
 * Written for this app; it is not taken from any course.
 */
import type { LessonBundle } from './schema.ts';

export const SAMPLE_LESSON_ID = 'esempio';

const lessonId = SAMPLE_LESSON_ID;

const words: Array<[hanzi: string, pinyin: string, meaning: string, pos: string]> = [
  ['你好', 'nǐ hǎo', 'ciao, buongiorno', ''],
  ['谢谢', 'xièxie', 'grazie', 'V.'],
  ['老师', 'lǎoshī', 'insegnante', 'N.'],
  ['学生', 'xuésheng', 'studente', 'N.'],
  ['朋友', 'péngyou', 'amico', 'N.'],
  ['茶', 'chá', 'tè', 'N.'],
  ['水', 'shuǐ', 'acqua', 'N.'],
  ['喝', 'hē', 'bere', 'V.'],
  ['喜欢', 'xǐhuan', 'piacere, amare', 'V.'],
  ['是', 'shì', 'essere', 'V.'],
  ['不', 'bù', 'non', 'AVV.'],
  ['也', 'yě', 'anche', 'AVV.'],
  ['一点儿', 'yìdiǎnr', "un po'", ''],
];

const sentences: Array<[zh: string, pinyin: string, it: string, words: string[]]> = [
  ['我是学生。', 'Wǒ shì xuésheng.', 'Sono uno studente.', ['我', '是', '学生']],
  ['她是我的老师。', 'Tā shì wǒ de lǎoshī.', 'Lei è la mia insegnante.', ['她', '是', '我', '的', '老师']],
  ['我喜欢喝茶。', 'Wǒ xǐhuan hē chá.', 'Mi piace bere il tè.', ['我', '喜欢', '喝', '茶']],
  ['我的朋友不喝茶。', 'Wǒ de péngyou bù hē chá.', 'Il mio amico non beve il tè.', ['我', '的', '朋友', '不', '喝', '茶']],
  ['老师也喜欢喝水。', 'Lǎoshī yě xǐhuan hē shuǐ.', "Anche all'insegnante piace bere l'acqua.", ['老师', '也', '喜欢', '喝', '水']],
];

export function sampleLesson(now: number): LessonBundle {
  return {
    lesson: {
      id: lessonId,
      number: 0,
      title: 'Lezione di esempio',
      summary: 'Poche parole e frasi per provare gli esercizi. Puoi eliminarla quando vuoi.',
      createdAt: now,
      files: [],
    },
    vocab: words.map(([hanzi, pinyin, meaning, pos], i) => ({
      id: `${lessonId}-v${i + 1}`,
      lessonId,
      order: i,
      hanzi,
      pinyin,
      meaning,
      pos,
      note: '',
    })),
    grammar: [
      {
        id: `${lessonId}-g1`,
        lessonId,
        order: 0,
        title: 'La negazione con 不',
        pattern: 'S + 不 + V',
        explanation: '不 si mette prima del verbo per negarlo.',
        examples: [{ zh: '我不喝茶。', pinyin: 'Wǒ bù hē chá.', it: 'Non bevo il tè.' }],
      },
    ],
    sentences: sentences.map(([zh, pinyin, it, parts], i) => ({
      id: `${lessonId}-s${i + 1}`,
      lessonId,
      order: i,
      zh,
      pinyin,
      it,
      words: parts,
      source: 'lezione' as const,
      acceptedZh: [],
      acceptedIt: [],
    })),
    clozes: [
      {
        id: `${lessonId}-c1`,
        lessonId,
        order: 0,
        text: '我____喜欢喝茶。',
        answer: '也',
        options: ['也', '是', '的'],
        translation: 'Anche a me piace bere il tè.',
        explanation: '也 (anche) va prima del verbo.',
        source: 'lezione' as const,
      },
    ],
  };
}

/**
 * Practice sessions: which exercises exist for the stored lessons, which are
 * due, and how performance turns into a spaced-repetition rating.
 */
import type { Snapshot } from './db.ts';
import { compactZh, hanChars, hasHan } from './hanzi.ts';
import type { PinyinGrade } from './pinyin.ts';
import { BLANK, SKILLS, type Sentence, type Skill, type Vocab } from './schema.ts';
import { isDue, isNew, type Rating } from './srs.ts';

export type Mode = Skill | 'mista';

/** A fill-in-the-blank exercise as shown: either stored or derived from a sentence. */
export interface ClozeView {
  text: string;
  answer: string;
  options: string[];
  translation: string;
  explanation: string;
}

interface Base {
  /** Card key: `<skill>:<itemId>`. */
  key: string;
  itemId: string;
  lessonId: string;
}

export type Exercise =
  | (Base & { skill: 'pinyin' | 'write'; vocab: Vocab })
  | (Base & { skill: 'it-zh' | 'zh-it' | 'order'; sentence: Sentence })
  | (Base & { skill: 'cloze'; cloze: ClozeView });

type Random = () => number;

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const MAX_WRITE_CHARS = 6;
const MIN_ORDER_WORDS = 3;
const MAX_ORDER_WORDS = 12;

/** True when the word list really is the sentence, cut into words. */
export const wordsMatch = (s: Sentence): boolean => s.words.length > 0 && s.words.join('') === compactZh(s.zh);

/**
 * Builds a fill-in-the-blank from a sentence by hiding one known word.
 * Wrong options are words with the same part of speech from the nearest lessons.
 */
export function deriveCloze(
  sentence: Sentence,
  vocab: readonly Vocab[],
  lessonNumber: (lessonId: string) => number,
  random: Random,
): ClozeView | null {
  if (sentence.words.length < MIN_ORDER_WORDS || !wordsMatch(sentence)) return null;
  const known = new Map(vocab.map((v) => [v.hanzi, v]));
  const hideable = sentence.words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => known.has(word) && sentence.words.filter((w) => w === word).length === 1);
  if (hideable.length === 0) return null;
  const { word: answer, index } = hideable[Math.floor(random() * hideable.length)]!;

  // Find where the hidden word sits in the sentence (punctuation included).
  let cursor = 0;
  let start = -1;
  for (let i = 0; i <= index; i++) {
    start = sentence.zh.indexOf(sentence.words[i]!, cursor);
    if (start < 0) return null;
    cursor = start + sentence.words[i]!.length;
  }

  const target = known.get(answer)!;
  const here = lessonNumber(sentence.lessonId);
  const inSentence = new Set(sentence.words);
  const pool = vocab.filter((v) => v.hanzi !== answer && !inSentence.has(v.hanzi) && hasHan(v.hanzi));
  const samePos = pool.filter((v) => target.pos !== '' && v.pos === target.pos);
  const ranked = (list: Vocab[]) =>
    shuffle(list, random).sort((a, b) => Math.abs(lessonNumber(a.lessonId) - here) - Math.abs(lessonNumber(b.lessonId) - here));
  const wrong: string[] = [];
  for (const v of [...ranked(samePos), ...ranked(pool)]) {
    if (wrong.length === 3) break;
    if (!wrong.includes(v.hanzi)) wrong.push(v.hanzi);
  }
  if (wrong.length < 2) return null;

  return {
    text: sentence.zh.slice(0, start) + BLANK + sentence.zh.slice(start + answer.length),
    answer,
    options: shuffle([answer, ...wrong], random),
    translation: sentence.it,
    explanation: '',
  };
}

/** Every exercise that can be made from the given lessons (all lessons when the list is empty). */
export function exercisesFor(data: Snapshot, lessons: readonly string[], random: Random = Math.random): Exercise[] {
  const wanted = (lessonId: string) => lessons.length === 0 || lessons.includes(lessonId);
  const numbers = new Map(data.lessons.map((l) => [l.id, l.number]));
  const lessonNumber = (lessonId: string) => numbers.get(lessonId) ?? 0;
  const byLesson = <T extends { lessonId: string; order: number }>(rows: readonly T[]) =>
    rows
      .filter((r) => wanted(r.lessonId))
      .sort((a, b) => lessonNumber(a.lessonId) - lessonNumber(b.lessonId) || a.order - b.order);
  const out: Exercise[] = [];
  const base = (skill: Skill, row: { id: string; lessonId: string }): Base => ({
    key: `${skill}:${row.id}`,
    itemId: row.id,
    lessonId: row.lessonId,
  });

  for (const vocab of byLesson(data.vocab)) {
    if (!hasHan(vocab.hanzi)) continue;
    if (vocab.pinyin.trim() !== '') out.push({ ...base('pinyin', vocab), skill: 'pinyin', vocab });
    if (hanChars(vocab.hanzi).length <= MAX_WRITE_CHARS) out.push({ ...base('write', vocab), skill: 'write', vocab });
  }

  for (const sentence of byLesson(data.sentences)) {
    if (sentence.it.trim() !== '') {
      out.push({ ...base('it-zh', sentence), skill: 'it-zh', sentence });
      out.push({ ...base('zh-it', sentence), skill: 'zh-it', sentence });
    }
    if (sentence.words.length >= MIN_ORDER_WORDS && sentence.words.length <= MAX_ORDER_WORDS && wordsMatch(sentence)) {
      out.push({ ...base('order', sentence), skill: 'order', sentence });
    }
    const derived = deriveCloze(sentence, data.vocab, lessonNumber, random);
    if (derived) out.push({ ...base('cloze', sentence), skill: 'cloze', cloze: derived });
  }

  for (const cloze of byLesson(data.clozes)) {
    const options = [...new Set([cloze.answer, ...cloze.options])];
    if (cloze.text.split(BLANK).length !== 2 || options.length < 2) continue;
    out.push({
      ...base('cloze', cloze),
      skill: 'cloze',
      cloze: {
        text: cloze.text,
        answer: cloze.answer,
        options: shuffle(options, random),
        translation: cloze.translation,
        explanation: cloze.explanation,
      },
    });
  }
  return out;
}

export interface Count {
  /** Reviewed before and due now. */
  due: number;
  /** Never practised. */
  fresh: number;
  total: number;
}

/** How much there is to do, per exercise type. */
export function counts(data: Snapshot, lessons: readonly string[], now: number): Record<Skill, Count> {
  const cards = new Map(data.cards.map((c) => [c.key, c]));
  const out = Object.fromEntries(SKILLS.map((s) => [s, { due: 0, fresh: 0, total: 0 }])) as Record<Skill, Count>;
  for (const e of exercisesFor(data, lessons, () => 0)) {
    const card = cards.get(e.key);
    const count = out[e.skill];
    count.total++;
    if (isNew(card)) count.fresh++;
    else if (isDue(card!, now)) count.due++;
  }
  return out;
}

export interface QueueOptions {
  mode: Mode;
  /** Exercise types a mixed session draws from. */
  skills: readonly Skill[];
  lessons: readonly string[];
  size: number;
  now: number;
  /** Also take items that are not due yet, when nothing else is left. */
  extra?: boolean;
  random?: Random;
}

function bySkill(items: Exercise[]): Exercise[][] {
  const groups = new Map<Skill, Exercise[]>();
  for (const e of items) groups.set(e.skill, [...(groups.get(e.skill) ?? []), e]);
  return [...groups.values()];
}

/** The exercises of one session: due ones first, then new ones. */
export function buildQueue(data: Snapshot, options: QueueOptions): Exercise[] {
  const random = options.random ?? Math.random;
  const skills = options.mode === 'mista' ? options.skills : [options.mode];
  const all = exercisesFor(data, options.lessons, random).filter((e) => skills.includes(e.skill));
  const cards = new Map(data.cards.map((c) => [c.key, c]));
  const dueAt = (e: Exercise) => cards.get(e.key)?.due ?? 0;

  const due = shuffle(
    all.filter((e) => !isNew(cards.get(e.key)) && isDue(cards.get(e.key)!, options.now)),
    random,
  ).sort((a, b) => dueAt(a) - dueAt(b));
  const fresh = bySkill(all.filter((e) => isNew(cards.get(e.key))));
  const later = options.extra
    ? all.filter((e) => !isNew(cards.get(e.key)) && !isDue(cards.get(e.key)!, options.now)).sort((a, b) => dueAt(a) - dueAt(b))
    : [];

  const picked: Exercise[] = [];
  const items = new Set<string>();
  // First pass: one exercise per word or sentence, so a session does not answer its own questions.
  for (const repeatItems of [false, true]) {
    const free = (e: Exercise) => !picked.includes(e) && (repeatItems || !items.has(e.itemId));
    const take = (e: Exercise | undefined): boolean => {
      if (!e || picked.length >= options.size || !free(e)) return false;
      picked.push(e);
      items.add(e.itemId);
      return true;
    };
    for (const e of due) take(e);
    // New items: one of each exercise type in turn, so a mixed session alternates.
    for (let progress = true; progress; ) {
      progress = false;
      for (const list of fresh) if (take(list.find(free))) progress = true;
    }
    for (const e of later) take(e);
  }
  return picked;
}

export const ratePinyin = (grade: PinyinGrade): Rating => (grade.verdict === 'correct' ? 'good' : 'again');

export interface WritingEffort {
  /** The full stroke animation was shown ("Mostra"). */
  revealed: boolean;
  /** The faint outline was shown ("Traccia"). */
  outlined: boolean;
  /** A stroke was hinted automatically after repeated misses. */
  hinted: boolean;
  mistakes: number;
  strokes: number;
}

/** The rating follows the help used (plan, section 8.2). */
export function rateWriting(effort: WritingEffort): Rating {
  if (effort.revealed) return 'again';
  const few = Math.max(2, Math.floor(effort.strokes / 4));
  if (effort.outlined || effort.hinted || effort.mistakes > few) return 'hard';
  return 'good';
}

/** Adds up the effort over the characters of a word. */
export function combineEffort(parts: readonly WritingEffort[]): WritingEffort {
  return parts.reduce(
    (sum, p) => ({
      revealed: sum.revealed || p.revealed,
      outlined: sum.outlined || p.outlined,
      hinted: sum.hinted || p.hinted,
      mistakes: sum.mistakes + p.mistakes,
      strokes: sum.strokes + p.strokes,
    }),
    { revealed: false, outlined: false, hinted: false, mistakes: 0, strokes: 0 },
  );
}

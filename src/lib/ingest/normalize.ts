/**
 * Cleans what the model returned before anyone sees it: look-alike characters,
 * stray spaces, entries without Chinese, duplicates, word lists that do not
 * match their sentence, fill-ins without exactly one blank. The result is a
 * draft for the review screen; nothing here is saved.
 */
import { newId } from '../db.ts';
import { compactZh, hanChars, hasHan, isHan, normalizeHan, unmappedRadicals } from '../hanzi.ts';
import { isPinyin, normalizePinyin, syllablesOf } from '../pinyin.ts';
import { BLANK, LIMITS, type Example, type Extraction, type Generation, type LessonBundle } from '../schema.ts';

export interface DraftVocab {
  hanzi: string;
  pinyin: string;
  meaning: string;
  pos: string;
  note: string;
  /** Already present in an earlier lesson. */
  known: boolean;
  /** The pinyin does not read as pinyin, or its syllables do not match the characters: check it. */
  suspect: boolean;
}

export interface DraftGrammar {
  title: string;
  pattern: string;
  explanation: string;
  examples: Example[];
}

export interface DraftSentence {
  zh: string;
  pinyin: string;
  it: string;
  /** Empty when the model's word list did not match the sentence. */
  words: string[];
  source: 'lezione' | 'compiti' | 'ai';
}

export interface DraftCloze {
  text: string;
  answer: string;
  options: string[];
  translation: string;
  explanation: string;
  source: 'lezione' | 'compiti' | 'ai';
}

export interface Draft {
  title: string;
  number: number;
  summary: string;
  vocab: DraftVocab[];
  grammar: DraftGrammar[];
  sentences: DraftSentence[];
  clozes: DraftCloze[];
  /** Things the user should know about, in Italian. */
  warnings: string[];
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A vocabulary entry: Chinese characters (and letters or digits inside words such as T恤), nothing else. */
export function cleanWord(raw: string): string {
  const withoutAsides = normalizeHan(raw).replace(/[（(][^）)]*[）)]/g, '');
  const kept = [...withoutAsides].filter((ch) => isHan(ch) || /[A-Za-z0-9]/.test(ch)).join('');
  return hasHan(kept) ? kept : '';
}

/** A Chinese sentence: real characters, no spaces between them. */
export function cleanSentence(raw: string): string {
  // Chinese characters and Chinese punctuation: a space next to one of them is never wanted.
  const cjk = '\\p{Script=Han}\\u3000-\\u303f\\uff00-\\uffef';
  return oneLine(normalizeHan(raw)).replace(new RegExp(`(?<=[${cjk}]) | (?=[${cjk}])`, 'gu'), '');
}

/** Every way a blank is typed (underscore runs, empty brackets) becomes the one blank. */
export function unifyBlank(text: string): string {
  return text.replace(/(?:[_＿]{2,}\s*)+|[（(]\s*[）)]/g, BLANK);
}

function cleanWords(words: readonly string[], zh: string): string[] {
  const cleaned = words.map((w) => compactZh(w)).filter((w) => w !== '');
  return cleaned.length > 1 && cleaned.join('') === compactZh(zh) ? cleaned : [];
}

/** True when the pinyin should be checked by a person. */
export function pinyinIsSuspect(pinyin: string, hanzi: string): boolean {
  if (pinyin === '' || !isPinyin(pinyin)) return true;
  const chars = hanChars(hanzi);
  if (chars.length !== [...hanzi].length) return false; // mixed word (letters inside): cannot compare counts
  return pinyin.split(/[/／]/).some((reading) => {
    const count = syllablesOf(reading, hanzi).length;
    const erhua = chars.filter((c, i) => c === '儿' && i > 0).length;
    return count !== chars.length && count !== chars.length - erhua;
  });
}

function cleanSentences(rows: ReadonlyArray<Omit<DraftSentence, 'source'> & { source?: DraftSentence['source'] }>, seen: Set<string>, fallback: DraftSentence['source']): DraftSentence[] {
  const out: DraftSentence[] = [];
  for (const row of rows) {
    const zh = cleanSentence(row.zh);
    const key = compactZh(zh);
    if (!hasHan(zh) || seen.has(key)) continue;
    seen.add(key);
    out.push({ zh, pinyin: normalizePinyin(row.pinyin), it: oneLine(row.it), words: cleanWords(row.words, zh), source: row.source ?? fallback });
  }
  return out;
}

function cleanClozes(rows: ReadonlyArray<Omit<DraftCloze, 'source'> & { source?: DraftCloze['source'] }>, seen: Set<string>, fallback: DraftCloze['source']): DraftCloze[] {
  const out: DraftCloze[] = [];
  for (const row of rows) {
    const text = unifyBlank(cleanSentence(row.text));
    const answer = cleanWord(row.answer);
    if (text.split(BLANK).length !== 2 || !hasHan(text) || answer === '' || seen.has(text)) continue;
    const options = [...new Set([answer, ...row.options.map(cleanWord).filter((o) => o !== '')])].slice(0, LIMITS.options);
    if (options.length < 2) continue;
    seen.add(text);
    out.push({ text, answer, options, translation: oneLine(row.translation), explanation: oneLine(row.explanation), source: row.source ?? fallback });
  }
  return out;
}

/** Lesson number from file names such as "03 - Lezione 3.pdf"; 0 when there is none. */
export function lessonNumberFromNames(names: readonly string[]): number {
  for (const name of names) {
    const match = /(?:^|\D)(\d{1,3})(?!\d)/.exec(name);
    if (match) return Number(match[1]);
  }
  return 0;
}

/** Turns the model's extraction into a clean draft. `known` holds the words of earlier lessons. */
export function normalizeExtraction(raw: Extraction, known: ReadonlySet<string>, fallbackNumber = 0): Draft {
  const warnings: string[] = [];
  const everything = JSON.stringify(raw);
  const odd = unmappedRadicals(everything);
  if (odd.length > 0) warnings.push(`Caratteri insoliti da controllare: ${odd.join(' ')}`);

  const vocab: DraftVocab[] = [];
  const seenWords = new Set<string>();
  let dropped = 0;
  for (const row of raw.vocab) {
    const hanzi = cleanWord(row.hanzi);
    if (hanzi === '' || seenWords.has(hanzi)) {
      if (hanzi === '') dropped++;
      continue;
    }
    seenWords.add(hanzi);
    const pinyin = normalizePinyin(row.pinyin);
    vocab.push({
      hanzi,
      pinyin,
      meaning: oneLine(row.meaning),
      pos: oneLine(row.pos),
      note: oneLine(row.note),
      known: known.has(hanzi),
      suspect: pinyinIsSuspect(pinyin, hanzi),
    });
  }
  if (dropped > 0) warnings.push(`${dropped} voci scartate perché senza caratteri cinesi.`);
  const suspects = vocab.filter((v) => v.suspect).length;
  if (suspects > 0) warnings.push(`${suspects} parole con pinyin da controllare (evidenziate).`);

  const grammar: DraftGrammar[] = raw.grammar
    .map((g) => ({
      title: oneLine(g.title),
      pattern: oneLine(normalizeHan(g.pattern)),
      explanation: g.explanation.trim(),
      examples: g.examples
        .map((e) => ({ zh: cleanSentence(e.zh), pinyin: normalizePinyin(e.pinyin), it: oneLine(e.it) }))
        .filter((e) => hasHan(e.zh)),
    }))
    .filter((g) => g.title !== '' || g.explanation !== '');

  const number = raw.number && raw.number > 0 ? raw.number : fallbackNumber;
  return {
    title: oneLine(raw.title) || (number > 0 ? `Lezione ${number}` : 'Lezione'),
    number,
    summary: raw.summary.trim(),
    vocab,
    grammar,
    sentences: cleanSentences(raw.sentences, new Set(), 'lezione'),
    clozes: cleanClozes(raw.clozes, new Set(), 'compiti'),
    warnings,
  };
}

/** Cleans generated exercises and drops the ones the lesson already has. */
export function normalizeGeneration(
  raw: Generation,
  existing: { sentences: readonly string[]; clozes: readonly string[] },
): { sentences: DraftSentence[]; clozes: DraftCloze[] } {
  return {
    sentences: cleanSentences(raw.sentences, new Set(existing.sentences.map(compactZh)), 'ai'),
    clozes: cleanClozes(raw.clozes, new Set(existing.clozes), 'ai'),
  };
}

type Identified<T> = T & { id: string; lessonId: string; order: number };

const identify = <T>(rows: readonly T[], lessonId: string, startAt = 0): Array<Identified<T>> =>
  rows.map((row, i) => ({ ...row, id: newId(), lessonId, order: startAt + i }));

export function sentencesToRecords(rows: readonly DraftSentence[], lessonId: string, startAt = 0) {
  return identify(
    rows.map((s) => ({ ...s, acceptedZh: [] as string[], acceptedIt: [] as string[] })),
    lessonId,
    startAt,
  );
}

export function clozesToRecords(rows: readonly DraftCloze[], lessonId: string, startAt = 0) {
  return identify(rows, lessonId, startAt);
}

/** Keeps a word list only while it still rebuilds the (possibly edited) sentence. */
export const wordsFor = (words: readonly string[], zh: string): string[] => cleanWords(words, zh);

/** The reviewed draft as records ready to be saved. */
export function draftToBundle(draft: Draft, lessonId: string, now: number, files: readonly string[]): LessonBundle {
  return {
    lesson: {
      id: lessonId,
      number: draft.number,
      title: draft.title.slice(0, LIMITS.short),
      summary: draft.summary.slice(0, LIMITS.long),
      createdAt: now,
      files: files.map((f) => f.slice(0, 260)).slice(0, 30),
    },
    vocab: identify(
      draft.vocab.map(({ hanzi, pinyin, meaning, pos, note }) => ({ hanzi, pinyin, meaning, pos, note })),
      lessonId,
    ),
    grammar: identify(draft.grammar, lessonId),
    sentences: sentencesToRecords(draft.sentences, lessonId),
    clozes: clozesToRecords(draft.clozes, lessonId),
  };
}

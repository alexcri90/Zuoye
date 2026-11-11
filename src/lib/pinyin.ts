/**
 * Pinyin: parsing, grading and tone-mark conversion.
 *
 * Internally "ü" is written "v" and tones are numbers: 1-4, 0 = neutral.
 * Syllables are recognised by rule (initial + final), not from a list. A few
 * impossible combinations pass; that is harmless, because an answer is always
 * compared with the expected pinyin and never judged on its own.
 */

const TONE_MARKS = ['̄', '́', '̌', '̀']; // tones 1-4
const BREVE = '̆'; // often found in place of the caron
const DIAERESIS = '̈';
const SCRIPT_A = 'ɑ';
const SCRIPT_G = 'ɡ';

const OPEN = ['a', 'o', 'e', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong'];
const I_FINALS = ['i', 'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing', 'iong'];
const U_FINALS = ['u', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang'];

const RULES: Array<[initials: string[], finals: string[]]> = [
  [[''], [...OPEN.filter((f) => f !== 'ong'), 'er']],
  [['b', 'p', 'm', 'f'], [...OPEN, 'i', 'ie', 'iao', 'iu', 'ian', 'in', 'ing', 'u']],
  [['d', 't', 'n', 'l'], [...OPEN, ...I_FINALS, 'u', 'uo', 'ui', 'uan', 'un']],
  [['n', 'l'], ['v', 've']],
  [['g', 'k', 'h'], [...OPEN, ...U_FINALS]],
  [['zh', 'ch', 'sh', 'r', 'z', 'c', 's'], [...OPEN, 'i', ...U_FINALS]],
  [['j', 'q', 'x'], [...I_FINALS, 'u', 'ue', 'uan', 'un']],
  [['y'], ['a', 'o', 'e', 'ao', 'ou', 'an', 'ang', 'ong', 'i', 'in', 'ing', 'u', 'ue', 'uan', 'un']],
  [['w'], ['a', 'o', 'ai', 'ei', 'an', 'en', 'ang', 'eng', 'u']],
];

const SYLLABLES = new Set<string>();
const ZERO_INITIAL = new Set<string>();
for (const [initials, finals] of RULES) {
  for (const initial of initials) {
    for (const final of finals) {
      SYLLABLES.add(initial + final);
      if (!initial) ZERO_INITIAL.add(final);
    }
  }
}
const MAX_SYLLABLE = 6;

const isVowel = (ch: string | undefined): boolean => ch !== undefined && 'aeiouv'.includes(ch);

function toneOfMark(ch: string): number {
  if (ch === BREVE) return 3;
  return TONE_MARKS.indexOf(ch) + 1;
}

/** Same sound, one spelling: "jv" = "ju", "lue" = "lve". Length is preserved. */
function canonicalRun(run: string): string {
  return run.replace(/([jqxy])v/g, '$1u').replace(/([ln])ue/g, '$1ve');
}

interface ToneNote {
  /** Index of the letter the tone sits on (mark) or follows (digit). */
  pos: number;
  tone: number;
}

interface Flat {
  letters: string;
  tones: ToneNote[];
  /** Letter runs; a run never spans a space, an apostrophe or a digit. */
  runs: Array<{ start: number; end: number }>;
}

/** Reduces any pinyin spelling to plain letters plus tone annotations. */
function flatten(input: string): Flat {
  const src = input.normalize('NFD').toLowerCase();
  let letters = '';
  const tones: ToneNote[] = [];
  const runs: Flat['runs'] = [];
  let runStart = -1;
  const closeRun = () => {
    if (runStart >= 0 && letters.length > runStart) {
      letters = letters.slice(0, runStart) + canonicalRun(letters.slice(runStart));
      runs.push({ start: runStart, end: letters.length });
    }
    runStart = -1;
  };
  for (const ch of src) {
    if ((ch >= 'a' && ch <= 'z') || ch === SCRIPT_A || ch === SCRIPT_G) {
      if (runStart < 0) runStart = letters.length;
      letters += ch === SCRIPT_A ? 'a' : ch === SCRIPT_G ? 'g' : ch;
    } else if (ch === DIAERESIS || ch === ':') {
      if (runStart >= 0 && letters.endsWith('u')) letters = `${letters.slice(0, -1)}v`;
      else closeRun();
    } else if (toneOfMark(ch) > 0) {
      if (runStart >= 0) tones.push({ pos: letters.length - 1, tone: toneOfMark(ch) });
    } else if (ch >= '0' && ch <= '5') {
      if (runStart >= 0) tones.push({ pos: letters.length - 1, tone: ch === '5' ? 0 : Number(ch) });
      closeRun();
    } else {
      closeRun();
    }
  }
  closeRun();
  return { letters, tones, runs };
}

interface Span {
  start: number;
  end: number;
  erhua: boolean;
}

/** All ways to cut a letter run into syllables (at most one tone mark each). */
function splits(run: string, marks: ReadonlySet<number>): Span[][] {
  const out: Span[][] = [];
  const marksIn = (from: number, to: number) => {
    let n = 0;
    for (let k = from; k < to; k++) if (marks.has(k)) n++;
    return n;
  };
  const walk = (i: number, acc: Span[]) => {
    if (out.length >= 32) return;
    if (i === run.length) {
      out.push(acc);
      return;
    }
    for (let len = Math.min(MAX_SYLLABLE, run.length - i); len >= 1; len--) {
      const end = i + len;
      if (!SYLLABLES.has(run.slice(i, end)) || marksIn(i, end) > 1) continue;
      walk(end, [...acc, { start: i, end, erhua: false }]);
      if (run[end] === 'r' && !isVowel(run[end + 1])) {
        walk(end + 1, [...acc, { start: i, end: end + 1, erhua: true }]);
      }
    }
  };
  walk(0, []);
  return out.sort((a, b) => cost(run, a) - cost(run, b));
}

/**
 * Pinyin spelling rules decide between cuts: inside a word a syllable that
 * starts with a vowel needs an apostrophe, so "fangan" is fan-gan and "xian"
 * is one syllable. Erhua is the least likely reading of an "r".
 */
function cost(run: string, spans: Span[]): number {
  let total = spans.length;
  spans.forEach((s, i) => {
    if (s.erhua) total += 10;
    if (i > 0 && ZERO_INITIAL.has(run.slice(s.start, s.erhua ? s.end - 1 : s.end))) total += 100;
  });
  return total;
}

interface Syllable extends Span {
  tone: number;
  /** The character this syllable reads, when characters and syllables line up. */
  char?: string;
}

interface Expected {
  letters: string;
  syllables: Syllable[];
}

const HAN = /\p{Script=Han}/u;

function parseExpected(pinyin: string, hanzi?: string): Expected {
  const flat = flatten(pinyin);
  const marks = new Set(flat.tones.map((t) => t.pos));
  const perRun = flat.runs.map((r) => {
    const local = new Set<number>();
    for (const m of marks) if (m >= r.start && m < r.end) local.add(m - r.start);
    const options = splits(flat.letters.slice(r.start, r.end), local);
    return options.length > 0 ? options : [[{ start: 0, end: r.end - r.start, erhua: false }]];
  });
  const chosen = perRun.map((options) => options[0]!);
  const chars = hanzi ? [...hanzi].filter((c) => HAN.test(c)) : [];

  // When a run can be cut in several ways, prefer the cut that matches the characters.
  if (chars.length > 0) {
    const total = chosen.reduce((n, spans) => n + spans.length, 0);
    const missing = chars.length - total;
    if (missing !== 0) {
      for (let r = 0; r < perRun.length; r++) {
        const wanted = chosen[r]!.length + missing;
        const alt = perRun[r]!.find((spans) => spans.length === wanted);
        if (alt) {
          chosen[r] = alt;
          break;
        }
      }
    }
  }

  const syllables: Syllable[] = [];
  chosen.forEach((spans, r) => {
    const offset = flat.runs[r]!.start;
    for (const s of spans) {
      const start = s.start + offset;
      const end = s.end + offset;
      const note = flat.tones.find((t) => t.pos >= start && t.pos < end);
      syllables.push({ start, end, erhua: s.erhua, tone: note ? note.tone : 0 });
    }
  });

  // Line characters up with syllables; an erhua syllable takes its 儿 with it.
  let c = 0;
  const aligned: Array<string | undefined> = [];
  for (const s of syllables) {
    aligned.push(chars[c]);
    c += s.erhua && chars[c + 1] === '儿' ? 2 : 1;
  }
  if (c === chars.length) syllables.forEach((s, i) => (s.char = aligned[i]));

  return { letters: flat.letters, syllables };
}

/** "wanr" may also be answered "wan er": the same reading, spelt out. */
function spellOutErhua(exp: Expected): Expected | null {
  if (!exp.syllables.some((s) => s.erhua)) return null;
  let letters = '';
  const syllables: Syllable[] = [];
  for (const s of exp.syllables) {
    const text = exp.letters.slice(s.start, s.erhua ? s.end - 1 : s.end);
    syllables.push({ start: letters.length, end: letters.length + text.length, erhua: false, tone: s.tone, char: s.char });
    letters += text;
    if (s.erhua) {
      syllables.push({ start: letters.length, end: letters.length + 2, erhua: false, tone: 0, char: '儿' });
      letters += 'er';
    }
  }
  return { letters, syllables };
}

/** Tones accepted for a syllable besides the written one (tone sandhi of 一 and 不). */
function acceptedTones(exp: Expected, i: number): number[] {
  const s = exp.syllables[i]!;
  const accepted = [s.tone];
  const next = exp.syllables[i + 1];
  if (s.char === '一') {
    accepted.push(1);
    // Before a 4th tone it is read 2nd, otherwise 4th; a neutral follower hides which.
    if (next) accepted.push(...(next.tone === 4 ? [2] : next.tone === 0 ? [2, 4] : [4]));
  } else if (s.char === '不') {
    accepted.push(4);
    if (next && (next.tone === 4 || next.tone === 0)) accepted.push(2);
  } else {
    return accepted;
  }
  if (i > 0) accepted.push(0); // 对不起, 看一看
  return accepted;
}

export type PinyinGrade =
  | { verdict: 'correct' }
  /** Right syllables; `wrong` lists the syllables (0-based) whose tone is wrong or missing. */
  | { verdict: 'tones'; wrong: number[]; missing: boolean }
  | { verdict: 'wrong' }
  | { verdict: 'empty' };

function gradeAgainst(user: Flat, exp: Expected): PinyinGrade {
  if (user.letters !== exp.letters) return { verdict: 'wrong' };
  const wrong: number[] = [];
  let missing = 0;
  exp.syllables.forEach((s, i) => {
    if (s.tone === 0) return; // written neutral: any tone is accepted
    const given = user.tones.filter((t) => t.pos >= s.start && t.pos < s.end).map((t) => t.tone);
    if (given.length === 0) {
      wrong.push(i);
      missing++;
      return;
    }
    // Two tones on one syllable means the answer reads it as two syllables.
    if (given.length > 1 || !acceptedTones(exp, i).includes(given[0]!)) wrong.push(i);
  });
  if (wrong.length === 0) return { verdict: 'correct' };
  return { verdict: 'tones', wrong, missing: missing === wrong.length };
}

const rank = (g: PinyinGrade): number =>
  g.verdict === 'correct' ? 1000 : g.verdict === 'tones' ? 500 - g.wrong.length : 0;

/** Readings separated by "/" are alternatives. */
function alternatives(expected: string): string[] {
  return expected
    .split(/[/／]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Grades a typed answer against the expected pinyin.
 * Accepts tone marks or numbers, any spacing, "v" or "u:" for "ü".
 */
export function gradePinyin(answer: string, expected: string, hanzi?: string): PinyinGrade {
  const user = flatten(answer);
  if (user.letters.length === 0) return { verdict: 'empty' };
  let best: PinyinGrade = { verdict: 'wrong' };
  for (const alt of alternatives(expected)) {
    const exp = parseExpected(alt, hanzi);
    for (const candidate of [exp, spellOutErhua(exp)]) {
      if (!candidate) continue;
      const grade = gradeAgainst(user, candidate);
      if (rank(grade) > rank(best)) best = grade;
    }
  }
  return best;
}

const isRunChar = (ch: string): boolean =>
  /[a-zA-Z]/.test(ch) || ch === DIAERESIS || ch === BREVE || TONE_MARKS.includes(ch);

/**
 * Puts a tone (1-4, or 0 to clear) on the last syllable of `text`, as when
 * typing "hao3". Returns null when the text does not end with a syllable.
 */
export function applyTone(text: string, tone: number): string | null {
  const nfd = text.normalize('NFD');
  let cut = nfd.length;
  while (cut > 0 && isRunChar(nfd[cut - 1]!)) cut--;
  const tail = nfd.slice(cut);
  const flat = flatten(tail);
  if (flat.runs.length !== 1) return null;

  // Position in `tail` of each plain letter.
  const at: number[] = [];
  for (let k = 0; k < tail.length; k++) if (/[a-zA-Z]/.test(tail[k]!)) at.push(k);
  if (at.length !== flat.letters.length) return null;

  const options = splits(flat.letters, new Set(flat.tones.map((t) => t.pos)));
  let first = -1;
  if (options.length > 0) {
    first = options[0]!.at(-1)!.start;
  } else {
    for (let len = Math.min(MAX_SYLLABLE, flat.letters.length); len >= 1 && first < 0; len--) {
      if (SYLLABLES.has(flat.letters.slice(-len))) first = flat.letters.length - len;
    }
  }
  if (first < 0) return null;

  const head = tail.slice(0, at[first]!);
  let syllable = '';
  for (const ch of tail.slice(at[first]!)) {
    if (ch === BREVE || TONE_MARKS.includes(ch)) continue;
    syllable += ch === 'v' ? `u${DIAERESIS}` : ch === 'V' ? `U${DIAERESIS}` : ch;
  }
  if (tone >= 1 && tone <= 4) {
    const plain = flat.letters.slice(first);
    let target = plain.search(/[ae]/);
    if (target < 0) target = plain.includes('ou') ? plain.indexOf('ou') : -1;
    if (target < 0) for (let k = plain.length - 1; k >= 0 && target < 0; k--) if (isVowel(plain[k])) target = k;
    if (target < 0) return null;
    // Walk to the target letter, then past its diaeresis if it has one.
    let seen = -1;
    let insertAt = -1;
    for (let k = 0; k < syllable.length && insertAt < 0; k++) {
      if (/[a-zA-Z]/.test(syllable[k]!)) seen++;
      if (seen === target) insertAt = syllable[k + 1] === DIAERESIS ? k + 2 : k + 1;
    }
    syllable = syllable.slice(0, insertAt) + TONE_MARKS[tone - 1]! + syllable.slice(insertAt);
  }
  return (nfd.slice(0, cut) + head + syllable).normalize('NFC');
}

/** Turns tone numbers into tone marks: "ni3 hao3" becomes "nǐ hǎo". */
export function numbersToMarks(input: string): string {
  let out = '';
  for (const ch of input) {
    if (ch >= '0' && ch <= '5' && out.length > 0) {
      const applied = applyTone(out, ch === '5' ? 0 : Number(ch));
      if (applied !== null) {
        out = applied;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/** Cleans pinyin coming from a lesson: one spelling for look-alike letters and marks. */
export function normalizePinyin(raw: string): string {
  const cleaned = raw
    .normalize('NFD')
    .replaceAll(BREVE, TONE_MARKS[2]!)
    .replaceAll(SCRIPT_A, 'a')
    .replaceAll(SCRIPT_G, 'g')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  return /[a-zA-Zü][1-5]/.test(cleaned) ? numbersToMarks(cleaned) : cleaned;
}

/** The expected reading, one tone-marked syllable per entry (first alternative). */
export function syllablesOf(expected: string, hanzi?: string): string[] {
  const first = alternatives(expected)[0];
  if (!first) return [];
  const exp = parseExpected(first, hanzi);
  return exp.syllables.map((s) => {
    const plain = exp.letters.slice(s.start, s.end);
    return applyTone(plain, s.tone) ?? plain;
  });
}

/** True when every part of the text reads as pinyin syllables. */
export function isPinyin(text: string): boolean {
  const flat = flatten(text);
  if (flat.runs.length === 0) return false;
  return flat.runs.every((r) => {
    const local = new Set<number>();
    for (const t of flat.tones) if (t.pos >= r.start && t.pos < r.end) local.add(t.pos - r.start);
    return splits(flat.letters.slice(r.start, r.end), local).length > 0;
  });
}

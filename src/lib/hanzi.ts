/**
 * Chinese-character helpers.
 *
 * The text layer of the course PDFs often holds "radical" code points that
 * look exactly like ordinary characters but are different to a computer, so
 * lookups and comparisons fail. They are mapped back here.
 */

// Kangxi Radicals block: Unicode itself maps each one to its character (NFKC).
const KANGXI_FIRST = 0x2f00;
const KANGXI_LAST = 0x2fd5;

// CJK Radicals Supplement block: no standard mapping for most, so the
// simplified forms that occur as whole characters are listed by code point.
const SUPPLEMENT_FIRST = 0x2e80;
const SUPPLEMENT_LAST = 0x2ef3;
const SUPPLEMENT = new Map<number, number>([
  [0x2ec5, 0x89c1],
  [0x2ecb, 0x8f66],
  [0x2ed3, 0x957f],
  [0x2edc, 0x98de],
  [0x2ee2, 0x9a6c],
  [0x2ee5, 0x9c7c],
  [0x2ec9, 0x8d1d],
  [0x2ed4, 0x95e8],
  [0x2eda, 0x9875],
  [0x2edb, 0x98ce],
  [0x2edd, 0x98df],
  [0x2ee6, 0x9e1f],
  [0x2ef0, 0x9f99],
  [0x2eec, 0x9f50],
  [0x2eee, 0x9f7f],
  [0x2ee8, 0x9ea6],
  [0x2ee9, 0x9ec4],
  [0x2ec6, 0x89d2],
  [0x2ed8, 0x9752],
  [0x2ed9, 0x97e6],
  [0x2ee3, 0x9aa8],
  [0x2ee4, 0x9b3c],
  [0x2ec4, 0x897f],
  [0x2ea0, 0x6c11],
]);

const isRadical = (cp: number): boolean =>
  (cp >= KANGXI_FIRST && cp <= KANGXI_LAST) || (cp >= SUPPLEMENT_FIRST && cp <= SUPPLEMENT_LAST);

/** Replaces radical look-alikes with the real characters; everything else is untouched. */
export function normalizeHan(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!isRadical(cp)) {
      out += ch;
      continue;
    }
    const mapped = SUPPLEMENT.get(cp);
    out += mapped !== undefined ? String.fromCodePoint(mapped) : ch.normalize('NFKC');
  }
  return out;
}

/** Radical look-alikes that `normalizeHan` could not replace (to flag for review). */
export function unmappedRadicals(text: string): string[] {
  const left = new Set<string>();
  for (const ch of normalizeHan(text)) if (isRadical(ch.codePointAt(0)!)) left.add(ch);
  return [...left];
}

const HAN = /\p{Script=Han}/u;

export const isHan = (ch: string): boolean => HAN.test(ch);

export const hasHan = (text: string): boolean => HAN.test(text);

/** The Chinese characters of a text, in order, without anything else. */
export const hanChars = (text: string): string[] => [...text].filter(isHan);

/** File name of a character's stroke data, as published under `hanzi/`. */
export const strokeFile = (ch: string): string => `${ch.codePointAt(0)!.toString(16)}.json`;

/** A Chinese sentence reduced to what matters when comparing answers. */
export function compactZh(text: string): string {
  return [...normalizeHan(text).normalize('NFKC')].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).join('').toLowerCase();
}

/** An Italian sentence reduced to what matters: no case, accents or punctuation. */
export function compactIt(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

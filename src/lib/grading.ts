/**
 * Grading a translation, cheapest way first:
 * 1. the answer equals the reference or an answer already judged correct: no request;
 * 2. otherwise one request to the model;
 * 3. no key, no network, no quota, or any other failure: the reference is
 *    shown and the student grades themself.
 */
import { compactIt, compactZh } from './hanzi.ts';
import { VERDICT_JSON_SCHEMA } from './llm/jsonSchemas.ts';
import { gradingParts, gradingSystem, type Direction } from './llm/prompts.ts';
import { LlmError, type Provider } from './llm/provider.ts';
import { LIMITS, VerdictSchema, type Sentence, type Verdict } from './schema.ts';
import type { Rating } from './srs.ts';

export type { Direction };

export type Outcome =
  /** Same as the reference or a cached accepted answer. */
  | { kind: 'exact' }
  | { kind: 'verdict'; verdict: Verdict }
  /** The model could not be asked; `reason` says why, in Italian. */
  | { kind: 'self'; reason: string };

const compact = (direction: Direction): ((text: string) => string) => (direction === 'it-zh' ? compactZh : compactIt);

/** What the student is translating from, and the reference translation. */
export function sides(direction: Direction, sentence: Sentence): { source: string; reference: string } {
  return direction === 'it-zh' ? { source: sentence.it, reference: sentence.zh } : { source: sentence.zh, reference: sentence.it };
}

const accepted = (direction: Direction, sentence: Sentence): string[] =>
  direction === 'it-zh' ? sentence.acceptedZh : sentence.acceptedIt;

/** True when the answer needs no judgement: punctuation, spaces, case and accents aside, it is a known good one. */
export function isKnownCorrect(direction: Direction, sentence: Sentence, answer: string): boolean {
  const norm = compact(direction);
  const given = norm(answer);
  if (given === '') return false;
  return [sides(direction, sentence).reference, ...accepted(direction, sentence)].some((good) => norm(good) === given);
}

/** The sentence with one more accepted answer remembered, or null when there is nothing to add. */
export function withAccepted(direction: Direction, sentence: Sentence, answer: string): Sentence | null {
  const clean = answer.trim().slice(0, direction === 'it-zh' ? LIMITS.short : LIMITS.pinyin);
  if (clean === '' || isKnownCorrect(direction, sentence, clean)) return null;
  const list = [...accepted(direction, sentence), clean].slice(-LIMITS.accepted);
  return direction === 'it-zh' ? { ...sentence, acceptedZh: list } : { ...sentence, acceptedIt: list };
}

/**
 * After a failure that will not go away by itself in a minute (no quota left,
 * key refused), the model is left alone for a while instead of being asked
 * again for every sentence of the session.
 */
const PAUSE_MS = 10 * 60_000;
const PAUSING: readonly string[] = ['quota', 'invalid-key', 'denied'];
let pause: { until: number; reason: string } | null = null;

/** Ends the pause (the key was changed, or a test starts). */
export function resumeModel(): void {
  pause = null;
}

/** Grades one answer. Never throws: every failure becomes self-assessment. */
export async function gradeTranslation(
  provider: Provider | null,
  direction: Direction,
  sentence: Sentence,
  answer: string,
  signal?: AbortSignal,
  now: number = Date.now(),
): Promise<Outcome> {
  if (isKnownCorrect(direction, sentence, answer)) return { kind: 'exact' };
  if (!provider) return { kind: 'self', reason: 'Sei offline: la correzione automatica non è disponibile.' };
  if (pause && now < pause.until) return { kind: 'self', reason: pause.reason };
  const { source, reference } = sides(direction, sentence);
  try {
    const verdict = await provider.generateJson({
      system: gradingSystem(direction),
      parts: gradingParts(source, reference, answer.slice(0, LIMITS.pinyin)),
      jsonSchema: VERDICT_JSON_SCHEMA,
      schema: VerdictSchema,
      effort: 'low',
      signal,
    });
    return { kind: 'verdict', verdict };
  } catch (error) {
    const reason = error instanceof LlmError ? error.message : 'La correzione automatica non è riuscita.';
    if (error instanceof LlmError && PAUSING.includes(error.kind)) pause = { until: now + PAUSE_MS, reason };
    return { kind: 'self', reason };
  }
}

export function rateVerdict(verdict: Verdict): Rating {
  return verdict.verdict === 'corretta' ? 'good' : verdict.verdict === 'quasi' ? 'hard' : 'again';
}

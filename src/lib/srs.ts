/**
 * Spaced repetition: a small SM-2 variant. One card per item per skill.
 * Times are epoch milliseconds; intervals are whole days.
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export interface Card {
  /** `<skill>:<itemId>` */
  key: string;
  /** When the card is next due. */
  due: number;
  /** Days between the last review and `due`; 0 while the item is being learned. */
  interval: number;
  ease: number;
  /** Successful reviews in a row. */
  reps: number;
  lapses: number;
  /** Time of the last review; 0 if never reviewed. */
  last: number;
}

const START_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3;
const MAX_INTERVAL = 365;

export function newCard(key: string): Card {
  return { key, due: 0, interval: 0, ease: START_EASE, reps: 0, lapses: 0, last: 0 };
}

/** Midnight (local time) of the day that contains `time`, shifted by whole days. */
export function startOfDay(time: number, plusDays = 0): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays).getTime();
}

const clampEase = (ease: number): number => Math.min(MAX_EASE, Math.max(MIN_EASE, Math.round(ease * 100) / 100));

/** The card after a review. Does not modify its argument. */
export function review(card: Card, rating: Rating, now: number): Card {
  const next: Card = { ...card, last: now };

  if (rating === 'again') {
    // Forgotten: back to learning, shown again in the same session.
    if (card.interval > 0) {
      next.lapses = card.lapses + 1;
      next.ease = clampEase(card.ease - 0.2);
    }
    next.interval = 0;
    next.reps = 0;
    next.due = now;
    return next;
  }

  let interval: number;
  if (card.interval === 0) {
    interval = rating === 'easy' ? 3 : 1;
  } else if (rating === 'hard') {
    interval = Math.max(card.interval + 1, Math.round(card.interval * 1.2));
    next.ease = clampEase(card.ease - 0.15);
  } else if (rating === 'good') {
    interval = Math.max(card.interval + 1, Math.round(card.interval * card.ease));
  } else {
    interval = Math.max(card.interval + 1, Math.round(card.interval * card.ease * 1.3));
    next.ease = clampEase(card.ease + 0.15);
  }

  next.interval = Math.min(MAX_INTERVAL, interval);
  next.reps = card.reps + 1;
  // Due dates snap to the start of the day, so an evening review is due the next morning.
  next.due = startOfDay(now, next.interval);
  return next;
}

/** A card is due from the start of its due day; a card never reviewed is new, not due. */
export const isDue = (card: Card, now: number): boolean => card.last > 0 && card.due <= now;

export const isNew = (card: Card | undefined): boolean => !card || card.last === 0;

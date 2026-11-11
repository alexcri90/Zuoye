import { describe, expect, it } from 'vitest';
import { isDue, isNew, newCard, review, startOfDay, type Card } from './srs.ts';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const evening = at(2026, 3, 10, 21, 30);

describe('new items', () => {
  it('start with default ease and count as new, not due', () => {
    const card = newCard('pinyin:a');
    expect(card.ease).toBe(2.5);
    expect(isNew(card)).toBe(true);
    expect(isNew(undefined)).toBe(true);
    expect(isDue(card, evening)).toBe(false);
  });

  it('again: repeats in the same session', () => {
    const card = review(newCard('k'), 'again', evening);
    expect(card.interval).toBe(0);
    expect(card.due).toBe(evening);
    expect(isDue(card, evening)).toBe(true);
    expect(card.lapses).toBe(0);
    expect(card.ease).toBe(2.5);
  });

  it('hard and good: due tomorrow morning', () => {
    for (const rating of ['hard', 'good'] as const) {
      const card = review(newCard('k'), rating, evening);
      expect(card.interval).toBe(1);
      expect(card.due).toBe(at(2026, 3, 11));
      expect(isDue(card, evening)).toBe(false);
      expect(isDue(card, at(2026, 3, 11, 7))).toBe(true);
    }
  });

  it('easy: due in three days', () => {
    const card = review(newCard('k'), 'easy', evening);
    expect(card.interval).toBe(3);
    expect(card.due).toBe(at(2026, 3, 13));
  });
});

describe('known items', () => {
  const known: Card = { key: 'k', due: at(2026, 3, 10), interval: 4, ease: 2.5, reps: 3, lapses: 0, last: at(2026, 3, 6, 9) };

  it('good multiplies the interval by the ease', () => {
    const card = review(known, 'good', evening);
    expect(card.interval).toBe(10);
    expect(card.ease).toBe(2.5);
    expect(card.reps).toBe(4);
    expect(card.due).toBe(at(2026, 3, 20));
  });

  it('hard grows slowly and lowers the ease', () => {
    const card = review(known, 'hard', evening);
    expect(card.interval).toBe(5);
    expect(card.ease).toBe(2.35);
  });

  it('easy grows fast and raises the ease', () => {
    const card = review(known, 'easy', evening);
    expect(card.interval).toBe(13);
    expect(card.ease).toBe(2.65);
  });

  it('again resets the interval, lowers the ease and counts a lapse', () => {
    const card = review(known, 'again', evening);
    expect(card.interval).toBe(0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(1);
    expect(card.ease).toBe(2.3);
    expect(card.due).toBe(evening);
    // Relearned the same evening: back tomorrow, like a new item.
    expect(review(card, 'good', evening).interval).toBe(1);
  });

  it('always grows by at least a day, and the ease stays within bounds', () => {
    const short: Card = { ...known, interval: 1, ease: 1.3 };
    expect(review(short, 'hard', evening).interval).toBe(2);
    expect(review(short, 'hard', evening).ease).toBe(1.3);
    expect(review(short, 'again', evening).ease).toBe(1.3);
    expect(review({ ...known, ease: 3 }, 'easy', evening).ease).toBe(3);
    expect(review({ ...known, interval: 300 }, 'easy', evening).interval).toBe(365);
  });

  it('does not modify the card it is given', () => {
    const before = { ...known };
    review(known, 'good', evening);
    expect(known).toEqual(before);
  });
});

describe('startOfDay', () => {
  it('snaps to local midnight and adds whole days across month ends', () => {
    expect(startOfDay(evening)).toBe(at(2026, 3, 10));
    expect(startOfDay(at(2026, 1, 31, 23, 59), 1)).toBe(at(2026, 2, 1));
    // Across the spring daylight-saving change the result is still midnight.
    expect(new Date(startOfDay(at(2026, 3, 28, 12), 2)).getHours()).toBe(0);
  });
});

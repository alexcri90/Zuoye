/** Stroke data for the writing exercise, loaded from the app's own address. */
import { z } from 'zod';
import { strokeFile } from './hanzi.ts';
import type { StrokeLevel } from './settings.ts';

const StrokesSchema = z.object({
  strokes: z.array(z.string().max(20000)).min(1).max(80),
  medians: z.array(z.array(z.array(z.number()).length(2)).max(400)).max(80),
  radStrokes: z.array(z.number()).max(80).optional(),
});

export type Strokes = z.infer<typeof StrokesSchema>;

export function strokesUrl(char: string, base: string): string {
  return new URL(`hanzi/${strokeFile(char)}`, base).href;
}

/**
 * Hanzi Writer's leniency for each setting. 1 is the library's default: it
 * scales how far a stroke may be from the model, where it may start and end,
 * and how closely its shape must follow. Values chosen by measurement; see
 * PLAN.md, section 19.3 (session 4).
 */
export const STROKE_LENIENCY: Record<StrokeLevel, number> = { precisa: 1, normale: 1.5, tollerante: 2 };

const warmed = new Set<string>();

/**
 * Fetches the stroke data of the given characters in the background, a few at
 * a time, so that the service worker has them cached before the device goes
 * offline. Failures are ignored: the character is simply tried again later.
 */
export async function warmStrokes(chars: Iterable<string>, base: string = document.baseURI): Promise<void> {
  const todo = [...new Set(chars)].filter((ch) => !warmed.has(ch));
  for (const ch of todo) warmed.add(ch);
  const queue = [...todo];
  const worker = async () => {
    for (let ch = queue.shift(); ch !== undefined; ch = queue.shift()) {
      try {
        const response = await fetch(strokesUrl(ch, base));
        // Read it to the end so the cached copy is complete; 404 means the character has no data.
        if (response.ok) await response.arrayBuffer();
        else if (response.status !== 404) warmed.delete(ch);
      } catch {
        warmed.delete(ch);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/** Rejects when the character has no stroke data or the device is offline and it is not cached. */
export async function loadStrokes(char: string, base: string = document.baseURI): Promise<Strokes> {
  const response = await fetch(strokesUrl(char, base));
  if (!response.ok) throw new Error(`no stroke data (${response.status})`);
  return StrokesSchema.parse(await response.json());
}

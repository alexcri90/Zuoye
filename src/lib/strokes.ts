/** Stroke data for the writing exercise, loaded from the app's own address. */
import { z } from 'zod';
import { strokeFile } from './hanzi.ts';

const StrokesSchema = z.object({
  strokes: z.array(z.string().max(20000)).min(1).max(80),
  medians: z.array(z.array(z.array(z.number()).length(2)).max(400)).max(80),
  radStrokes: z.array(z.number()).max(80).optional(),
});

export type Strokes = z.infer<typeof StrokesSchema>;

export function strokesUrl(char: string, base: string): string {
  return new URL(`hanzi/${strokeFile(char)}`, base).href;
}

/** Rejects when the character has no stroke data or the device is offline and it is not cached. */
export async function loadStrokes(char: string, base: string = document.baseURI): Promise<Strokes> {
  const response = await fetch(strokesUrl(char, base));
  if (!response.ok) throw new Error(`no stroke data (${response.status})`);
  return StrokesSchema.parse(await response.json());
}

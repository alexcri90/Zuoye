import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ExtractionSchema, GenerationSchema, VerdictSchema } from '../schema.ts';
import { EXTRACTION_JSON_SCHEMA, GENERATION_JSON_SCHEMA, VERDICT_JSON_SCHEMA } from './jsonSchemas.ts';

type Node = { type?: string; properties?: Record<string, Node>; required?: string[]; items?: Node; enum?: string[] };

const ALLOWED = new Set(['type', 'properties', 'required', 'items', 'enum', 'description']);

/** The smallest value a model could return while following the schema. */
function sample(node: Node): unknown {
  if (node.enum) return node.enum[0];
  switch (node.type) {
    case 'object':
      return Object.fromEntries(Object.entries(node.properties ?? {}).map(([k, v]) => [k, sample(v)]));
    case 'array':
      return [sample(node.items ?? {})];
    case 'integer':
      return 1;
    default:
      return 'x';
  }
}

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const child of Object.values(node.properties ?? {})) walk(child, visit);
  if (node.items) walk(node.items, visit);
}

const cases: Array<[string, Record<string, unknown>, z.ZodType]> = [
  ['extraction', EXTRACTION_JSON_SCHEMA, ExtractionSchema],
  ['generation', GENERATION_JSON_SCHEMA, GenerationSchema],
  ['verdict', VERDICT_JSON_SCHEMA, VerdictSchema],
];

describe.each(cases)('%s schema', (_name, jsonSchema, zodSchema) => {
  it('uses only plain keywords, and every required field exists', () => {
    walk(jsonSchema, (node) => {
      for (const key of Object.keys(node)) expect(ALLOWED.has(key), key).toBe(true);
      for (const name of node.required ?? []) expect(Object.keys(node.properties ?? {})).toContain(name);
    });
  });

  it('describes answers that pass the validation, field for field', () => {
    const value = sample(jsonSchema);
    const parsed = zodSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    // Nothing the model is asked for is dropped by the validation, and nothing is validated that was not asked for.
    const keys = (v: unknown): string[] =>
      Array.isArray(v)
        ? keys(v[0]).map((k) => `[].${k}`)
        : typeof v === 'object' && v !== null
          ? Object.entries(v).flatMap(([k, child]) => [k, ...keys(child).map((c) => `${k}.${c}`)])
          : [];
    expect(keys(parsed.data).sort()).toEqual(keys(value).sort());
  });
});

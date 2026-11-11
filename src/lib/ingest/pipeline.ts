/**
 * From the chosen files to a draft lesson, and from a saved lesson to extra
 * exercises. Reading happens on the device; one request goes to the model for
 * each of the two steps.
 */
import type { Snapshot } from '../db.ts';
import { normalizeHan } from '../hanzi.ts';
import { EXTRACTION_JSON_SCHEMA, GENERATION_JSON_SCHEMA } from '../llm/jsonSchemas.ts';
import { EXTRACTION_SYSTEM, GENERATION_SYSTEM, extractionParts, generationParts, type SourceText } from '../llm/prompts.ts';
import type { Provider } from '../llm/provider.ts';
import { ExtractionSchema, GenerationSchema, type Cloze, type Sentence } from '../schema.ts';
import { docxToText } from './docx.ts';
import { imageFileToJpeg } from './image.ts';
import {
  clozesToRecords,
  lessonNumberFromNames,
  normalizeExtraction,
  normalizeGeneration,
  sentencesToRecords,
  type Draft,
} from './normalize.ts';
import { MAX_PAGES, readPdf } from './pdf.ts';

const MB = 1024 * 1024;
const LIMITS = { pdf: 80 * MB, docx: 20 * MB, image: 25 * MB, text: 2 * MB };
const MAX_FILES = 8;
const MAX_TEXT_CHARS = 200_000;
/** Room left under the request limit for instructions and wrapping. */
const IMAGE_BUDGET_CHARS = 14_000_000;

export type FileKind = 'pdf' | 'docx' | 'image' | 'text' | 'other';

export function fileKind(name: string, type = ''): FileKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (/\.(png|jpe?g|webp)$/.test(lower) || /^image\/(png|jpeg|webp)$/.test(type)) return 'image';
  if (/\.(txt|md)$/.test(lower) || type === 'text/plain') return 'text';
  return 'other';
}

export interface ReadResult {
  sources: SourceText[];
  names: string[];
  /** Notes for the user, in Italian. */
  warnings: string[];
}

export interface ReadProgress {
  file: string;
  /** Page being read, for PDFs. */
  page?: number;
  pages?: number;
}

/**
 * Drops page images until the request fits. Pages with the most text lose
 * their picture first: they depend on it least.
 */
export function fitImageBudget(sources: SourceText[], budget = IMAGE_BUDGET_CHARS): number {
  const size = () => sources.reduce((n, s) => n + s.images.reduce((m, i) => m + i.data.length, 0), 0);
  const candidates = sources
    .flatMap((source) => source.images.map((image) => ({ source, image })))
    .sort((a, b) => b.image.textLength - a.image.textLength);
  let dropped = 0;
  for (const { source, image } of candidates) {
    if (size() <= budget) break;
    source.images.splice(source.images.indexOf(image), 1);
    dropped++;
  }
  return dropped;
}

/** Reads the chosen files on the device. Unsupported or oversized files are skipped with a warning. */
export async function readFiles(
  files: readonly File[],
  onProgress: (progress: ReadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<ReadResult> {
  const sources: SourceText[] = [];
  const names: string[] = [];
  const warnings: string[] = [];
  if (files.length > MAX_FILES) warnings.push(`Troppi file: uso solo i primi ${MAX_FILES}.`);
  const pdfCount = files.filter((f) => fileKind(f.name, f.type) === 'pdf').length;

  for (const file of files.slice(0, MAX_FILES)) {
    signal?.throwIfAborted();
    const kind = fileKind(file.name, file.type);
    const n = sources.length + 1;
    onProgress({ file: file.name });
    if (kind === 'other') {
      warnings.push(`${file.name}: formato non supportato (uso PDF, DOCX, immagini, TXT).`);
      continue;
    }
    if (file.size > LIMITS[kind]) {
      warnings.push(`${file.name}: file troppo grande, saltato.`);
      continue;
    }
    try {
      if (kind === 'pdf') {
        const pdf = await readPdf(new Uint8Array(await file.arrayBuffer()), {
          // Several PDFs in one lesson: smaller pictures, so that they all fit.
          width: pdfCount > 1 ? 850 : 1000,
          onPage: (page, pages) => onProgress({ file: file.name, page, pages }),
          signal,
        });
        if (pdf.totalPages > MAX_PAGES) warnings.push(`${file.name}: lette solo le prime ${MAX_PAGES} pagine su ${pdf.totalPages}.`);
        sources.push({
          label: `Documento ${n} (PDF)`,
          text: normalizeHan(pdf.pages.map((p) => `--- pagina ${p.number} ---\n${p.text}`).join('\n')).slice(0, MAX_TEXT_CHARS),
          images: pdf.pages.flatMap((p) => (p.image ? [{ ...p.image, caption: `pagina ${p.number}`, textLength: p.text.length }] : [])),
        });
      } else if (kind === 'docx') {
        sources.push({
          label: `Documento ${n} (Word)`,
          text: normalizeHan(docxToText(new Uint8Array(await file.arrayBuffer()))),
          images: [],
        });
      } else if (kind === 'image') {
        sources.push({
          label: `Documento ${n} (immagine)`,
          text: '',
          images: [{ ...(await imageFileToJpeg(file)), caption: 'immagine intera', textLength: 0 }],
        });
      } else {
        sources.push({ label: `Documento ${n} (testo)`, text: normalizeHan(await file.text()).slice(0, MAX_TEXT_CHARS), images: [] });
      }
      names.push(file.name);
    } catch (error) {
      if (signal?.aborted) throw error;
      warnings.push(`${file.name}: non sono riuscito a leggerlo.`);
    }
  }

  const dropped = fitImageBudget(sources);
  if (dropped > 0) warnings.push(`Materiale molto pesante: ${dropped} pagine sono state inviate solo come testo.`);
  return { sources, names, warnings };
}

/** One request: the material of a lesson in, a cleaned draft out. */
export async function extractLesson(
  provider: Provider,
  read: ReadResult,
  knownWords: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<Draft> {
  const raw = await provider.generateJson({
    system: EXTRACTION_SYSTEM,
    parts: extractionParts(read.sources),
    jsonSchema: EXTRACTION_JSON_SCHEMA,
    schema: ExtractionSchema,
    signal,
  });
  const draft = normalizeExtraction(raw, knownWords, lessonNumberFromNames(read.names));
  draft.warnings.unshift(...read.warnings);
  return draft;
}

/** One request, text only: new sentences and fill-ins on the grammar of a saved lesson. */
export async function generateExercises(
  provider: Provider,
  data: Snapshot,
  lessonId: string,
  signal?: AbortSignal,
): Promise<{ sentences: Sentence[]; clozes: Cloze[] }> {
  const lesson = data.lessons.find((l) => l.id === lessonId);
  if (!lesson) return { sentences: [], clozes: [] };
  const earlier = new Set(
    data.lessons.filter((l) => l.id !== lessonId && (l.number < lesson.number || (l.number === lesson.number && l.createdAt < lesson.createdAt))).map((l) => l.id),
  );
  const mine = <T extends { lessonId: string }>(rows: readonly T[]) => rows.filter((r) => r.lessonId === lessonId);
  const lessonWords = mine(data.vocab).map((v) => v.hanzi);

  const raw = await provider.generateJson({
    system: GENERATION_SYSTEM,
    parts: generationParts({
      grammar: mine(data.grammar).map((g) => ({
        title: g.title,
        pattern: g.pattern,
        explanation: g.explanation,
        examples: g.examples.map((e) => e.zh),
      })),
      lessonWords,
      earlierWords: [...new Set(data.vocab.filter((v) => earlier.has(v.lessonId)).map((v) => v.hanzi))].filter((w) => !lessonWords.includes(w)),
    }),
    jsonSchema: GENERATION_JSON_SCHEMA,
    schema: GenerationSchema,
    signal,
  });

  const sentences = mine(data.sentences);
  const clozes = mine(data.clozes);
  const cleaned = normalizeGeneration(raw, { sentences: sentences.map((s) => s.zh), clozes: clozes.map((c) => c.text) });
  const next = (rows: ReadonlyArray<{ order: number }>) => rows.reduce((max, r) => Math.max(max, r.order + 1), 0);
  return {
    sentences: sentencesToRecords(cleaned.sentences, lessonId, next(sentences)),
    clozes: clozesToRecords(cleaned.clozes, lessonId, next(clozes)),
  };
}

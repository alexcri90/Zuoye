/**
 * Shapes of everything the app stores or receives, as zod schemas.
 *
 * Two families:
 * - strict schemas (domain records, backups): a value that does not fit is rejected;
 * - lenient schemas (model output): strings and lists are cut to size instead,
 *   so one long explanation does not throw away a whole lesson.
 */
import { z } from 'zod';

export const SKILLS = ['pinyin', 'write', 'it-zh', 'zh-it', 'cloze', 'order'] as const;
export type Skill = (typeof SKILLS)[number];

export const SOURCES = ['lezione', 'compiti', 'ai'] as const;

/** The blank in a fill-in sentence. */
export const BLANK = '____';

export const LIMITS = {
  hanzi: 40,
  pinyin: 600,
  short: 300,
  long: 3000,
  options: 6,
  examples: 12,
  words: 80,
  accepted: 50,
  vocab: 400,
  grammar: 60,
  sentences: 400,
  clozes: 300,
  lessons: 300,
} as const;

// ---------- strict: domain records ----------

const id = z.string().min(1).max(64);
const str = (max: number) => z.string().max(max);
/** Position inside the lesson, as in the course material. */
const order = z.number().int().min(0).max(100000);
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max);

export const LessonSchema = z.object({
  id,
  number: z.number().int().min(0).max(999),
  title: str(LIMITS.short),
  summary: str(LIMITS.long),
  createdAt: z.number(),
  files: list(str(260), 30),
});

export const VocabSchema = z.object({
  id,
  lessonId: id,
  order,
  hanzi: str(LIMITS.hanzi).min(1),
  pinyin: str(LIMITS.pinyin),
  meaning: str(LIMITS.short),
  pos: str(40),
  note: str(LIMITS.long),
});

export const ExampleSchema = z.object({
  zh: str(LIMITS.short),
  pinyin: str(LIMITS.pinyin),
  it: str(LIMITS.pinyin),
});

export const GrammarSchema = z.object({
  id,
  lessonId: id,
  order,
  title: str(LIMITS.short),
  pattern: str(LIMITS.short),
  explanation: str(LIMITS.long),
  examples: list(ExampleSchema, LIMITS.examples),
});

export const SentenceSchema = z.object({
  id,
  lessonId: id,
  order,
  zh: str(LIMITS.short).min(1),
  pinyin: str(LIMITS.pinyin),
  it: str(LIMITS.pinyin),
  /** Word segmentation of `zh`; empty when unknown. */
  words: list(str(LIMITS.hanzi), LIMITS.words),
  source: z.enum(SOURCES),
  /** Answers the model has already judged correct (no second request for the same answer). */
  acceptedZh: list(str(LIMITS.short), LIMITS.accepted),
  acceptedIt: list(str(LIMITS.pinyin), LIMITS.accepted),
});

export const ClozeSchema = z.object({
  id,
  lessonId: id,
  order,
  /** Sentence with exactly one BLANK. */
  text: str(LIMITS.short).min(1),
  answer: str(LIMITS.hanzi).min(1),
  options: list(str(LIMITS.hanzi), LIMITS.options),
  translation: str(LIMITS.pinyin),
  explanation: str(LIMITS.long),
  source: z.enum(SOURCES),
});

export const CardSchema = z.object({
  key: z.string().min(3).max(100),
  due: z.number(),
  interval: z.number().min(0).max(100000),
  ease: z.number().min(1).max(5),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  last: z.number(),
});

export type Lesson = z.infer<typeof LessonSchema>;
export type Vocab = z.infer<typeof VocabSchema>;
export type Example = z.infer<typeof ExampleSchema>;
export type Grammar = z.infer<typeof GrammarSchema>;
export type Sentence = z.infer<typeof SentenceSchema>;
export type Cloze = z.infer<typeof ClozeSchema>;

/** One lesson with everything that belongs to it. */
export interface LessonBundle {
  lesson: Lesson;
  vocab: Vocab[];
  grammar: Grammar[];
  sentences: Sentence[];
  clozes: Cloze[];
}

// ---------- strict: files exchanged with the outside ----------

const bundleFields = {
  vocab: list(VocabSchema, 20000),
  grammar: list(GrammarSchema, 5000),
  sentences: list(SentenceSchema, 30000),
  clozes: list(ClozeSchema, 30000),
};

export const BackupSchema = z.object({
  app: z.literal('zuoye'),
  kind: z.literal('backup'),
  version: z.literal(1),
  exportedAt: z.number(),
  lessons: list(LessonSchema, LIMITS.lessons),
  ...bundleFields,
  cards: list(CardSchema, 200000),
});

export const LessonPackSchema = z.object({
  app: z.literal('zuoye'),
  kind: z.literal('lesson'),
  version: z.literal(1),
  exportedAt: z.number(),
  lesson: LessonSchema,
  ...bundleFields,
});

export type Backup = z.infer<typeof BackupSchema>;
export type LessonPack = z.infer<typeof LessonPackSchema>;

// ---------- lenient: model output ----------

/** A string cut to size; missing or null becomes empty. */
const cut = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s ?? '').trim().slice(0, max));

/** A list cut to size; missing or null becomes empty. */
const some = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .nullish()
    .transform((a) => (a ?? []).slice(0, max));

const ExampleOut = z.object({ zh: cut(LIMITS.short), pinyin: cut(LIMITS.pinyin), it: cut(LIMITS.pinyin) });

const SentenceOut = z.object({
  zh: cut(LIMITS.short),
  pinyin: cut(LIMITS.pinyin),
  it: cut(LIMITS.pinyin),
  words: some(cut(LIMITS.hanzi), LIMITS.words),
  source: z.enum(['lezione', 'compiti']).catch('lezione'),
});

const ClozeOut = z.object({
  text: cut(LIMITS.short),
  answer: cut(LIMITS.hanzi),
  options: some(cut(LIMITS.hanzi), LIMITS.options),
  translation: cut(LIMITS.pinyin),
  explanation: cut(LIMITS.long),
  source: z.enum(['lezione', 'compiti']).catch('compiti'),
});

/** What the extraction request returns for one lesson. */
export const ExtractionSchema = z.object({
  title: cut(LIMITS.short),
  number: z.number().int().min(0).max(999).nullish().catch(null),
  summary: cut(LIMITS.long),
  vocab: some(
    z.object({
      hanzi: cut(LIMITS.hanzi),
      pinyin: cut(LIMITS.pinyin),
      meaning: cut(LIMITS.short),
      pos: cut(40),
      note: cut(LIMITS.long),
    }),
    LIMITS.vocab,
  ),
  grammar: some(
    z.object({
      title: cut(LIMITS.short),
      pattern: cut(LIMITS.short),
      explanation: cut(LIMITS.long),
      examples: some(ExampleOut, LIMITS.examples),
    }),
    LIMITS.grammar,
  ),
  sentences: some(SentenceOut, LIMITS.sentences),
  clozes: some(ClozeOut, LIMITS.clozes),
});

/** What the exercise-generation request returns. */
export const GenerationSchema = z.object({
  sentences: some(SentenceOut.omit({ source: true }), 60),
  clozes: some(ClozeOut.omit({ source: true }), 60),
});

export const VERDICTS = ['corretta', 'quasi', 'errata'] as const;
export const ERROR_TYPES = ['grammatica', 'lessico', 'caratteri', 'ordine', 'significato'] as const;

/** What the grading request returns for one translation. */
export const VerdictSchema = z.object({
  verdict: z.enum(VERDICTS),
  score: z
    .number()
    .catch(0)
    .transform((n) => Math.min(100, Math.max(0, Math.round(n)))),
  corrected: cut(LIMITS.short),
  correctedPinyin: cut(LIMITS.pinyin),
  comment: cut(1000),
  errors: some(z.object({ type: z.enum(ERROR_TYPES).catch('grammatica'), detail: cut(LIMITS.short) }), 8),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;

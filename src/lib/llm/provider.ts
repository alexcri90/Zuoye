/**
 * The one door to a language model. The app only knows this interface, so a
 * different provider can replace Gemini without touching the screens.
 */
import type { z } from 'zod';

export type Part = { text: string } | { image: { mimeType: string; data: string } };

export interface JsonRequest<T> {
  /** Instructions for the model. */
  system: string;
  /** The material: text and base64 images, in order. */
  parts: Part[];
  /** JSON Schema sent to the model to shape its answer. */
  jsonSchema: Record<string, unknown>;
  /** The answer is always validated with this schema, whatever the model was told. */
  schema: z.ZodType<T>;
  /** 'low' asks for a quick answer (grading); the default lets the model think. */
  effort?: 'low' | 'default';
  signal?: AbortSignal;
}

/** The outcome of one tiny trial request to a model. */
export interface ModelTest {
  model: string;
  ok: boolean;
  /** Why it failed, in Italian with the service's own words; empty when it worked. */
  detail: string;
}

export interface Provider {
  generateJson<T>(request: JsonRequest<T>): Promise<T>;
  /** Names of the models this key can use. */
  listModels(signal?: AbortSignal): Promise<string[]>;
  /** Asks each configured model for one word, to see which of them really answer. */
  testModels(signal?: AbortSignal): Promise<ModelTest[]>;
}

export type LlmErrorKind =
  | 'no-key'
  | 'invalid-key'
  | 'denied'
  | 'quota'
  | 'model'
  | 'blocked'
  | 'truncated'
  | 'network'
  | 'server'
  | 'bad-request'
  | 'bad-response'
  | 'too-large'
  | 'aborted';

const MESSAGES: Record<LlmErrorKind, string> = {
  'no-key': 'Manca la chiave API: inseriscila nelle impostazioni.',
  'invalid-key': 'Chiave non valida: controllala nelle impostazioni.',
  denied: "Il progetto Google di questa chiave non ha accesso gratuito all'API.",
  quota: 'Quota gratuita esaurita per ora. Riprova più tardi: la quota del giorno riparte verso le 9 del mattino.',
  model: 'Il modello scelto non è disponibile: scegline un altro nelle impostazioni.',
  blocked: 'Il modello ha rifiutato la richiesta. Non è stato salvato nulla.',
  truncated: 'La risposta del modello è arrivata incompleta. Non è stato salvato nulla: riprova con meno pagine.',
  network: 'Connessione assente o richiesta bloccata. Controlla la rete e riprova.',
  server: 'Il servizio del modello ha risposto con un errore. Riprova tra poco.',
  'bad-request': 'Il modello non ha accettato la richiesta.',
  'bad-response': 'Il modello ha risposto in un formato inatteso. Riprova.',
  'too-large': 'I file sono troppo pesanti per una sola richiesta: carica meno pagine.',
  aborted: 'Operazione annullata.',
};

/** An error with a message in Italian that can be shown as it is. It never contains the key. */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  /** What the service said, cleaned of secrets; for the small print. */
  readonly detail: string;

  constructor(kind: LlmErrorKind, detail = '') {
    super(MESSAGES[kind]);
    this.name = 'LlmError';
    this.kind = kind;
    this.detail = detail;
  }
}

/** True when trying again later, or without the model, is the sensible reaction. */
export const isUnavailable = (error: unknown): boolean =>
  error instanceof LlmError && ['no-key', 'invalid-key', 'denied', 'quota', 'model', 'network', 'server'].includes(error.kind);

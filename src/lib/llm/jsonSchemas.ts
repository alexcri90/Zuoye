/**
 * JSON Schemas sent to the model to shape its answers.
 * Only the plain keywords every model version understands are used (type,
 * properties, required, items, enum, description). The answer is validated
 * again with the zod schemas in ../schema.ts, which are the real gate.
 */
import { ERROR_TYPES, VERDICTS } from '../schema.ts';

type JsonSchema = Record<string, unknown>;

const text = (description: string): JsonSchema => ({ type: 'string', description });

const object = (properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties).filter((name) => !optional.includes(name)),
});

const list = (items: JsonSchema, description: string): JsonSchema => ({ type: 'array', items, description });

const zh = text('Frase in cinese semplificato, con la punteggiatura.');
const pinyin = text('Pinyin con i segni dei toni; sillabe di una parola unite, parole separate da spazi.');
const it = text('Traduzione italiana naturale.');
const words = list(text('Una parola cinese.'), 'La frase divisa in parole, senza punteggiatura: unite ridanno la frase.');

const sentenceFields = { zh, pinyin, it, words };

const clozeFields = {
  text: text('Frase cinese con esattamente uno spazio vuoto scritto ____'),
  answer: text('La parola che completa la frase.'),
  options: list(text('Una scelta, in cinese.'), 'Da 2 a 4 scelte, compresa la risposta giusta.'),
  translation: text('Traduzione italiana della frase completa.'),
  explanation: text('Una frase in italiano sul perché della risposta.'),
};

const source = { type: 'string', enum: ['lezione', 'compiti'], description: 'Da dove viene: slide della lezione o compiti.' };

export const EXTRACTION_JSON_SCHEMA: JsonSchema = object({
  title: text('Titolo breve della lezione, in italiano.'),
  number: { type: 'integer', description: 'Numero della lezione; 0 se non è indicato.' },
  summary: text('Due o tre frasi in italiano su che cosa si impara.'),
  vocab: list(
    object({
      hanzi: text('La parola in caratteri semplificati, solo caratteri.'),
      pinyin,
      meaning: text('Significato in italiano, breve.'),
      pos: text('Categoria grammaticale come nei materiali (N., V., AGG., AVV.); vuoto se non indicata.'),
      note: text("Nota d'uso breve in italiano; vuoto se non serve."),
    }),
    'Le parole nuove della lezione, in ordine.',
  ),
  grammar: list(
    object({
      title: text('Nome del punto di grammatica.'),
      pattern: text('La struttura, per esempio: V + 得 + AGG'),
      explanation: text('Spiegazione concisa in italiano.'),
      examples: list(object({ zh, pinyin, it }), 'Da 2 a 4 esempi presi dai materiali.'),
    }),
    'I punti di grammatica spiegati nella lezione.',
  ),
  sentences: list(object({ ...sentenceFields, source }), 'Frasi di esempio, battute dei dialoghi, frasi dei compiti.'),
  clozes: list(object({ ...clozeFields, source }), 'Esercizi a completamento o a scelta multipla dei compiti, risolti.'),
});

export const GENERATION_JSON_SCHEMA: JsonSchema = object({
  sentences: list(object(sentenceFields), 'Frasi nuove che usano la grammatica della lezione.'),
  clozes: list(object(clozeFields), 'Esercizi a completamento mirati alla grammatica della lezione.'),
});

export const VERDICT_JSON_SCHEMA: JsonSchema = object({
  verdict: { type: 'string', enum: [...VERDICTS], description: 'Giudizio complessivo.' },
  score: { type: 'integer', description: 'Punteggio da 0 a 100.' },
  corrected: text('La versione corretta più vicina alla risposta dello studente.'),
  correctedPinyin: text('Pinyin della versione corretta se è in cinese, altrimenti vuoto.'),
  comment: text('Una o due frasi in italiano rivolte allo studente.'),
  errors: list(
    object({
      type: { type: 'string', enum: [...ERROR_TYPES], description: 'Tipo di errore.' },
      detail: text('Che cosa è sbagliato, in italiano, in breve.'),
    }),
    'Gli errori trovati; vuoto se la risposta è corretta.',
  ),
});

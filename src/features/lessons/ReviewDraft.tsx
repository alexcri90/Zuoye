import { Zh } from '../../components/ui.tsx';
import { pinyinIsSuspect, wordsFor, type Draft, type DraftSentence, type DraftVocab } from '../../lib/ingest/normalize.ts';
import { BLANK, LIMITS } from '../../lib/schema.ts';

interface Props {
  draft: Draft;
  onChange: (draft: Draft) => void;
}

const without = <T,>(rows: readonly T[], index: number): T[] => rows.filter((_, i) => i !== index);
const replaced = <T,>(rows: readonly T[], index: number, row: T): T[] => rows.map((r, i) => (i === index ? row : r));

/**
 * The extracted lesson, editable before anything is saved. Wrong pinyin
 * learned from the app would be worse than no app, so words are shown first
 * and doubtful pinyin is marked.
 */
export function ReviewDraft({ draft, onChange }: Props) {
  const setVocab = (index: number, patch: Partial<DraftVocab>) => {
    const next = { ...draft.vocab[index]!, ...patch };
    next.suspect = pinyinIsSuspect(next.pinyin, next.hanzi);
    onChange({ ...draft, vocab: replaced(draft.vocab, index, next) });
  };
  const setSentence = (index: number, patch: Partial<DraftSentence>) => {
    const next = { ...draft.sentences[index]!, ...patch };
    next.words = wordsFor(next.words, next.zh);
    onChange({ ...draft, sentences: replaced(draft.sentences, index, next) });
  };
  const knownCount = draft.vocab.filter((v) => v.known).length;

  return (
    <div className="stack">
      <label className="field">
        <span>Titolo</span>
        <input
          className="input"
          value={draft.title}
          maxLength={LIMITS.short}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Numero della lezione</span>
        <input
          className="input"
          inputMode="numeric"
          value={draft.number === 0 ? '' : String(draft.number)}
          onChange={(e) => onChange({ ...draft, number: Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 0) })}
        />
      </label>

      {draft.warnings.length > 0 && (
        <div className="notice small stack" role="note">
          {draft.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      <details className="group" open>
        <summary>
          Parole <span className="muted">{draft.vocab.length}</span>
        </summary>
        {knownCount > 0 && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => onChange({ ...draft, vocab: draft.vocab.filter((v) => !v.known) })}
          >
            Togli le {knownCount} già note
          </button>
        )}
        {draft.vocab.map((v, i) => (
          <div key={i} className={v.suspect ? 'edit-row suspect' : 'edit-row'}>
            <input
              className="edit zh"
              lang="zh-Hans"
              aria-label="Caratteri"
              value={v.hanzi}
              maxLength={LIMITS.hanzi}
              onChange={(e) => setVocab(i, { hanzi: e.target.value })}
            />
            <input
              className="edit"
              aria-label="Pinyin"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={v.pinyin}
              maxLength={120}
              onChange={(e) => setVocab(i, { pinyin: e.target.value })}
            />
            <button
              type="button"
              className="remove"
              aria-label={`Elimina ${v.hanzi}`}
              onClick={() => onChange({ ...draft, vocab: without(draft.vocab, i) })}
            >
              ×
            </button>
            <input
              className="edit wide"
              aria-label="Significato"
              value={v.meaning}
              maxLength={LIMITS.short}
              onChange={(e) => setVocab(i, { meaning: e.target.value })}
            />
            {(v.suspect || v.known) && (
              <span className="tags">
                {v.suspect && <span className="tag bad">controlla il pinyin</span>}
                {v.known && <span className="tag">già nota</span>}
              </span>
            )}
          </div>
        ))}
      </details>

      <details className="group">
        <summary>
          Frasi <span className="muted">{draft.sentences.length}</span>
        </summary>
        {draft.sentences.map((s, i) => (
          <div key={i} className="edit-row">
            <input
              className="edit zh span"
              lang="zh-Hans"
              aria-label="Frase in cinese"
              value={s.zh}
              maxLength={LIMITS.short}
              onChange={(e) => setSentence(i, { zh: e.target.value })}
            />
            <button
              type="button"
              className="remove"
              aria-label={`Elimina la frase ${i + 1}`}
              onClick={() => onChange({ ...draft, sentences: without(draft.sentences, i) })}
            >
              ×
            </button>
            <input
              className="edit wide"
              aria-label="Traduzione"
              value={s.it}
              maxLength={LIMITS.pinyin}
              onChange={(e) => setSentence(i, { it: e.target.value })}
            />
            <span className="tags">
              <span className="tag">{s.source === 'compiti' ? 'compiti' : 'lezione'}</span>
              <span className="muted small">{s.pinyin}</span>
            </span>
          </div>
        ))}
      </details>

      <details className="group">
        <summary>
          Grammatica <span className="muted">{draft.grammar.length}</span>
        </summary>
        {draft.grammar.map((g, i) => (
          <div key={i} className="read-row">
            <div className="row-main">
              <p className="row-title">{g.title}</p>
              <p className="small">
                <Zh>{g.pattern}</Zh>
              </p>
              <p className="muted small">{g.explanation}</p>
            </div>
            <button
              type="button"
              className="remove"
              aria-label={`Elimina il punto ${i + 1}`}
              onClick={() => onChange({ ...draft, grammar: without(draft.grammar, i) })}
            >
              ×
            </button>
          </div>
        ))}
      </details>

      <details className="group">
        <summary>
          Esercizi dei compiti <span className="muted">{draft.clozes.length}</span>
        </summary>
        <p className="muted small">Le soluzioni sono del modello, non dell&apos;insegnante: togli quelle che non ti convincono.</p>
        {draft.clozes.map((c, i) => (
          <div key={i} className="read-row">
            <div className="row-main">
              <p>
                <Zh>{c.text.replace(BLANK, ' ＿＿ ')}</Zh>
              </p>
              <p className="small">
                Risposta: <Zh>{c.answer}</Zh> <span className="muted">tra</span> <Zh>{c.options.join(' · ')}</Zh>
              </p>
              <p className="muted small">{c.translation}</p>
            </div>
            <button
              type="button"
              className="remove"
              aria-label={`Elimina l'esercizio ${i + 1}`}
              onClick={() => onChange({ ...draft, clozes: without(draft.clozes, i) })}
            >
              ×
            </button>
          </div>
        ))}
      </details>
    </div>
  );
}

import { useState } from 'react';
import { Zh } from '../../components/ui.tsx';
import { scramble } from '../../lib/practice.ts';
import type { Sentence } from '../../lib/schema.ts';
import type { Rating } from '../../lib/srs.ts';

/** Bonus exercise: tap the words into the right order. */
export function OrderExercise({ sentence, onDone }: { sentence: Sentence; onDone: (rating: Rating) => void }) {
  const [tiles] = useState(() => scramble(sentence.words));
  const [placed, setPlaced] = useState<number[]>([]);
  const [result, setResult] = useState<'right' | 'wrong' | 'skipped' | null>(null);

  const wordOf = (id: number) => tiles.find((t) => t.id === id)?.word ?? '';
  const check = () => setResult(placed.map(wordOf).join('') === sentence.words.join('') ? 'right' : 'wrong');

  return (
    <div className="exercise">
      <div className="prompt">
        <span className="prompt-label">Riordina le parole</span>
        {sentence.it && <span className="prompt-meaning">{sentence.it}</span>}
      </div>

      <div className={result === 'right' ? 'answer-line ok' : result ? 'answer-line bad' : 'answer-line'} aria-label="La tua frase">
        {placed.map((id) => (
          <button
            key={id}
            type="button"
            className="tile"
            disabled={result !== null}
            aria-label={`Togli ${wordOf(id)}`}
            onClick={() => setPlaced((p) => p.filter((x) => x !== id))}
          >
            <Zh>{wordOf(id)}</Zh>
          </button>
        ))}
      </div>

      {result === null ? (
        <>
          <div className="tiles" role="group" aria-label="Parole da usare">
            {tiles
              .filter((t) => !placed.includes(t.id))
              .map((t) => (
                <button key={t.id} type="button" className="tile" onClick={() => setPlaced((p) => [...p, t.id])}>
                  <Zh>{t.word}</Zh>
                </button>
              ))}
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-quiet" onClick={() => setResult('skipped')}>
              Non lo so
            </button>
            <button type="button" className="btn btn-primary" disabled={placed.length !== tiles.length} onClick={check}>
              Verifica
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={result === 'right' ? 'feedback ok' : 'feedback bad'} role="status">
            <span className="feedback-title">{result === 'right' ? 'Giusto' : result === 'wrong' ? "L'ordine non è questo" : 'Ecco la frase'}</span>
            <Zh className="zh-line">{sentence.zh}</Zh>
            <span className="pinyin-small" lang="zh-Latn">
              {sentence.pinyin}
            </span>
          </div>
          <button type="button" className="btn btn-primary btn-block" autoFocus onClick={() => onDone(result === 'right' ? 'good' : 'again')}>
            Avanti
          </button>
        </>
      )}
    </div>
  );
}

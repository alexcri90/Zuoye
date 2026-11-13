import { useState } from 'react';
import { Zh } from '../../components/ui.tsx';
import type { ClozeView } from '../../lib/practice.ts';
import { BLANK } from '../../lib/schema.ts';
import type { Rating } from '../../lib/srs.ts';

/** Exercise 5: choose the word that fills the blank. */
export function ClozeExercise({ cloze, onDone }: { cloze: ClozeView; onDone: (rating: Rating) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [before = '', after = ''] = cloze.text.split(BLANK);
  const correct = picked === cloze.answer;

  return (
    <div className="exercise">
      <div className="prompt">
        <span className="prompt-label">Completa la frase</span>
        <p className="zh-sentence">
          <Zh>{before}</Zh>
          <span className={picked === null ? 'gap' : correct ? 'gap ok' : 'gap bad'}>{picked !== null && <Zh>{cloze.answer}</Zh>}</span>
          <Zh>{after}</Zh>
        </p>
      </div>

      {picked !== null && (
        <div className={correct ? 'feedback ok' : 'feedback bad'} role="status">
          <span className="feedback-title">{correct ? 'Giusto' : 'Sbagliato'}</span>
          {cloze.translation && <p>{cloze.translation}</p>}
          {cloze.explanation && <p className="small">{cloze.explanation}</p>}
        </div>
      )}

      <div className="options" role="group" aria-label="Scelte">
        {cloze.options.map((option) => {
          const state = picked === null ? '' : option === cloze.answer ? ' right' : option === picked ? ' wrong' : '';
          return (
            <button key={option} type="button" className={`option${state}`} disabled={picked !== null} onClick={() => setPicked(option)}>
              <Zh>{option}</Zh>
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <button type="button" className="btn btn-primary btn-block" autoFocus onClick={() => onDone(correct ? 'good' : 'again')}>
          Avanti
        </button>
      )}
    </div>
  );
}

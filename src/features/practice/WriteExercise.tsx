import { useState } from 'react';
import { HanziQuiz } from '../../components/HanziQuiz.tsx';
import { Zh } from '../../components/ui.tsx';
import { hanChars } from '../../lib/hanzi.ts';
import { combineEffort, rateWriting, type WritingEffort } from '../../lib/practice.ts';
import type { Vocab } from '../../lib/schema.ts';
import type { Rating } from '../../lib/srs.ts';
import { STROKE_LENIENCY } from '../../lib/strokes.ts';
import { useStore } from '../../store.ts';

const OUTCOME: Record<Rating, { title: string; ok: boolean }> = {
  easy: { title: 'Ben scritto', ok: true },
  good: { title: 'Ben scritto', ok: true },
  hard: { title: 'Scritto con un aiuto', ok: true },
  again: { title: 'Da ripassare: tornerà tra poco', ok: false },
};

/** Exercise 2: from pinyin and meaning, write the word one character at a time. */
export function WriteExercise({ vocab, onDone }: { vocab: Vocab; onDone: (rating: Rating | null) => void }) {
  const { prefs } = useStore();
  const chars = hanChars(vocab.hanzi);
  const [position, setPosition] = useState(0);
  const [efforts, setEfforts] = useState<WritingEffort[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);

  const finished = position >= chars.length;
  // No rating when no character could be practised.
  const rating = efforts.length > 0 ? rateWriting(combineEffort(efforts)) : null;
  const outcome = rating ? OUTCOME[rating] : null;

  return (
    <div className="exercise">
      <div className="prompt">
        <span className="prompt-label">Scrivi in caratteri</span>
        <span className="prompt-meaning">{vocab.meaning}</span>
        <span className="pinyin" lang="zh-Latn">
          {vocab.pinyin}
        </span>
      </div>

      {finished ? (
        <>
          <Zh className={chars.length > 3 ? 'zh-big long' : 'zh-big'}>{vocab.hanzi}</Zh>
          <div className={outcome?.ok === false ? 'feedback bad' : 'feedback ok'} role="status">
            <span className="feedback-title">{outcome ? outcome.title : 'Saltato'}</span>
            {skipped.length > 0 && (
              <span className="small">
                Tratti non disponibili per <Zh>{skipped.join(' ')}</Zh>.
              </span>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-block" autoFocus onClick={() => onDone(rating)}>
            Avanti
          </button>
        </>
      ) : (
        <div className="grid-wrap">
          {chars.length > 1 && (
            <div className="char-dots" aria-label={`Carattere ${position + 1} di ${chars.length}`}>
              {chars.map((ch, i) => (
                <span key={i} className={i === position ? 'char-dot current' : 'char-dot'}>
                  {i < position && <Zh>{ch}</Zh>}
                </span>
              ))}
            </div>
          )}
          <HanziQuiz
            key={position}
            char={chars[position]!}
            leniency={STROKE_LENIENCY[prefs.strokes]}
            onComplete={(effort) => {
              setEfforts((list) => [...list, effort]);
              setPosition((p) => p + 1);
            }}
            onSkip={() => {
              setSkipped((list) => [...list, chars[position]!]);
              setPosition((p) => p + 1);
            }}
          />
        </div>
      )}
    </div>
  );
}

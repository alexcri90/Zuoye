import { useState } from 'react';
import { buildQueue, type Exercise, type Mode } from '../../lib/practice.ts';
import { newCard, review, type Rating } from '../../lib/srs.ts';
import { navigate } from '../../router.ts';
import { useStore } from '../../store.ts';
import { ClozeExercise } from './ClozeExercise.tsx';
import { OrderExercise } from './OrderExercise.tsx';
import { PinyinExercise } from './PinyinExercise.tsx';
import { ENABLED_SKILLS } from './skills.ts';
import { TranslateExercise } from './TranslateExercise.tsx';
import { WriteExercise } from './WriteExercise.tsx';

/** How many times a missed item comes back within the same session. */
const MAX_REPEATS = 2;

type Tally = Record<Rating, number>;

function ExerciseView({ exercise, onDone }: { exercise: Exercise; onDone: (rating: Rating | null) => void }) {
  switch (exercise.skill) {
    case 'pinyin':
      return <PinyinExercise vocab={exercise.vocab} onDone={onDone} />;
    case 'write':
      return <WriteExercise vocab={exercise.vocab} onDone={onDone} />;
    case 'it-zh':
    case 'zh-it':
      return <TranslateExercise sentence={exercise.sentence} direction={exercise.skill} onDone={onDone} />;
    case 'cloze':
      return <ClozeExercise cloze={exercise.cloze} onDone={onDone} />;
    case 'order':
      return <OrderExercise sentence={exercise.sentence} onDone={onDone} />;
  }
}

/** One practice session: a queue of exercises, one at a time, then a summary. */
export function Practice({ mode, extra }: { mode: Mode; extra: boolean }) {
  const { data, prefs, saveCard } = useStore();
  const [queue, setQueue] = useState<Exercise[]>(() =>
    buildQueue(data, {
      mode,
      skills: ENABLED_SKILLS,
      lessons: prefs.lessons.filter((id) => data.lessons.some((l) => l.id === id)),
      size: prefs.sessionSize,
      now: Date.now(),
      extra,
    }),
  );
  const [planned] = useState(queue.length);
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState<Tally>({ again: 0, hard: 0, good: 0, easy: 0 });

  const current = queue[index];

  const done = (rating: Rating | null) => {
    if (!current) return;
    if (rating) {
      const card = data.cards.find((c) => c.key === current.key) ?? newCard(current.key);
      void saveCard(review(card, rating, Date.now()));
      // Only the first answer to an item counts in the summary.
      if (queue.indexOf(current) === index) setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
      const shown = queue.filter((e) => e.key === current.key).length;
      if (rating === 'again' && shown <= MAX_REPEATS) setQueue((q) => [...q, current]);
    }
    setIndex((i) => i + 1);
  };

  const passed = tally.good + tally.easy + tally.hard;

  return (
    <main className="practice">
      <div className="practice-top">
        <button type="button" className="close" aria-label="Chiudi la sessione" onClick={() => navigate('/')}>
          ×
        </button>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index}>
          <span style={{ width: `${queue.length === 0 ? 100 : (index / queue.length) * 100}%` }} />
        </div>
        <span className="progress-count">
          {Math.min(index + 1, queue.length)}/{queue.length}
        </span>
      </div>

      {current ? (
        <ExerciseView key={index} exercise={current} onDone={done} />
      ) : planned === 0 ? (
        <div className="summary">
          <h1 className="page-title">Niente da ripassare</h1>
          <p className="muted">Per oggi è tutto. Torna domani, oppure aggiungi una lezione.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/')}>
            Torna agli esercizi
          </button>
        </div>
      ) : (
        <div className="summary">
          <p className="section-title">Sessione finita</p>
          <p className="summary-figure">
            {passed}/{planned}
          </p>
          <p className="muted">risposte giuste al primo tentativo</p>
          <div className="tally">
            <span>
              <strong>{tally.good + tally.easy}</strong>bene
            </span>
            <span>
              <strong>{tally.hard}</strong>con aiuto
            </span>
            <span>
              <strong>{tally.again}</strong>da rivedere
            </span>
          </div>
          <button type="button" className="btn btn-primary" autoFocus onClick={() => navigate('/')}>
            Torna agli esercizi
          </button>
        </div>
      )}
    </main>
  );
}

import { useState } from 'react';
import { PageHead } from '../../components/ui.tsx';
import { count } from '../../lib/italian.ts';
import { SAMPLE_LESSON_ID, sampleLesson } from '../../lib/sample.ts';
import { useStore } from '../../store.ts';

/** The list of lessons. */
export function Lessons() {
  const { data, db, refresh } = useStore();
  const [busy, setBusy] = useState(false);
  const hasSample = data.lessons.some((l) => l.id === SAMPLE_LESSON_ID);

  const addSample = async () => {
    setBusy(true);
    try {
      await db.saveLesson(sampleLesson(Date.now()));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <PageHead title="Lezioni" />

      <a className="btn btn-primary btn-block" href="#/lessons/new">
        Aggiungi una lezione
      </a>

      {data.lessons.length === 0 ? (
        <div className="notice stack">
          <p>Qui compaiono le lezioni del corso, con le parole e le frasi estratte dai materiali.</p>
          <p className="muted small">Per provare subito gli esercizi puoi caricare una piccola lezione di esempio.</p>
        </div>
      ) : (
        <div className="list">
          {data.lessons.map((lesson) => {
            const words = data.vocab.filter((v) => v.lessonId === lesson.id).length;
            const sentences = data.sentences.filter((s) => s.lessonId === lesson.id).length;
            return (
              <a key={lesson.id} className="row" href={`#/lessons/${lesson.id}`}>
                <span className="row-main">
                  <span className="row-title">{lesson.number > 0 ? `${lesson.number}. ${lesson.title}` : lesson.title}</span>
                  <br />
                  <span className="muted small">
                    {count(words, 'parola', 'parole')} · {count(sentences, 'frase', 'frasi')}
                  </span>
                </span>
                <span className="muted" aria-hidden="true">
                  ›
                </span>
              </a>
            );
          })}
        </div>
      )}

      {!hasSample && (
        <button type="button" className="btn btn-block" disabled={busy} onClick={() => void addSample()}>
          Carica la lezione di esempio
        </button>
      )}
    </main>
  );
}

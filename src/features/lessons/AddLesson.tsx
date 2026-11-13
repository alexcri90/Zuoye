import { useEffect, useRef, useState } from 'react';
import { PageHead } from '../../components/ui.tsx';
import { newId } from '../../lib/db.ts';
import { draftToBundle, type Draft } from '../../lib/ingest/normalize.ts';
import { extractLesson, fileKind, generateExercises, readFiles, type ReadProgress } from '../../lib/ingest/pipeline.ts';
import { count } from '../../lib/italian.ts';
import { currentProvider, hasApiKey } from '../../lib/llm/index.ts';
import { LlmError } from '../../lib/llm/provider.ts';
import { navigate } from '../../router.ts';
import { useStore } from '../../store.ts';
import { ReviewDraft } from './ReviewDraft.tsx';

type Stage =
  | { name: 'pick' }
  | { name: 'reading'; progress: ReadProgress }
  | { name: 'asking' }
  | { name: 'review'; draft: Draft; names: string[] }
  | { name: 'saving' }
  | { name: 'generating' }
  | { name: 'done'; lessonId: string; note: string };

const describe = (error: unknown, fallback: string): string =>
  error instanceof LlmError ? (error.detail ? `${error.message} (${error.detail})` : error.message) : fallback;

/** Adding a lesson: files, extraction, review, save, then extra exercises. */
export function AddLesson() {
  const { data, db, prefs, refresh } = useStore();
  const [stage, setStage] = useState<Stage>({ name: 'pick' });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [keyPresent] = useState(() => hasApiKey());
  const controller = useRef<AbortController | null>(null);

  // Leaving the screen cancels whatever is running.
  useEffect(() => () => controller.current?.abort(), []);

  const extract = async () => {
    const run = new AbortController();
    controller.current = run;
    setError(null);
    try {
      setStage({ name: 'reading', progress: { file: files[0]?.name ?? '' } });
      const read = await readFiles(files, (progress) => setStage({ name: 'reading', progress }), run.signal);
      if (read.sources.length === 0) {
        setError(['Nessun file leggibile.', ...read.warnings].join(' '));
        setStage({ name: 'pick' });
        return;
      }
      setStage({ name: 'asking' });
      const known = new Set(data.vocab.map((v) => v.hanzi));
      const draft = await extractLesson(currentProvider(prefs), read, known, run.signal);
      setStage({ name: 'review', draft, names: read.names });
    } catch (e) {
      if (!run.signal.aborted) setError(describe(e, 'Non sono riuscito a leggere i file.'));
      setStage({ name: 'pick' });
    }
  };

  const save = async (draft: Draft, names: string[]) => {
    const run = new AbortController();
    controller.current = run;
    setError(null);
    const lessonId = newId();
    try {
      setStage({ name: 'saving' });
      await db.saveLesson(draftToBundle(draft, lessonId, Date.now(), names));
      await refresh();
    } catch {
      setError('Non sono riuscito a salvare la lezione: forse lo spazio del browser è esaurito.');
      setStage({ name: 'review', draft, names });
      return;
    }
    // The lesson is safe from here on; extra exercises can fail or be skipped.
    let note: string;
    try {
      setStage({ name: 'generating' });
      const extra = await generateExercises(currentProvider(prefs), await db.snapshot(), lessonId, run.signal);
      await db.addExercises(extra.sentences, extra.clozes);
      await refresh();
      note = `Esercizi aggiunti: ${count(extra.sentences.length, 'frase', 'frasi')} e ${count(extra.clozes.length, 'completamento', 'completamenti')}.`;
    } catch (e) {
      note = run.signal.aborted
        ? 'Generazione degli esercizi saltata: puoi farla più tardi dalla pagina della lezione.'
        : `Esercizi aggiuntivi non generati: ${describe(e, 'errore imprevisto.')} Puoi riprovare dalla pagina della lezione.`;
    }
    setStage({ name: 'done', lessonId, note });
  };

  if (stage.name === 'review') {
    const { draft, names } = stage;
    return (
      <main className="page">
        <PageHead title="Controlla" />
        <p className="muted small">
          Niente è ancora salvato. Correggi o elimina ciò che non va, soprattutto il pinyin: è quello che imparerai.
        </p>
        {error && (
          <p className="notice bad small" role="alert">
            {error}
          </p>
        )}
        <ReviewDraft draft={draft} onChange={(next) => setStage({ name: 'review', draft: next, names })} />
        <div className="btn-row sticky-actions">
          <button type="button" className="btn" onClick={() => setStage({ name: 'pick' })}>
            Annulla
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={draft.vocab.length + draft.sentences.length === 0}
            onClick={() => void save(draft, names)}
          >
            Salva la lezione
          </button>
        </div>
      </main>
    );
  }

  if (stage.name === 'done') {
    return (
      <main className="page">
        <PageHead title="Lezione salvata" />
        <p className="notice">{stage.note}</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(`/lessons/${stage.lessonId}`, true)}>
          Apri la lezione
        </button>
      </main>
    );
  }

  if (stage.name !== 'pick') {
    const p = stage.name === 'reading' ? stage.progress : null;
    return (
      <main className="page">
        <PageHead title="Nuova lezione" />
        <div className="notice stack" role="status" aria-live="polite">
          {stage.name === 'reading' && (
            <>
              <p className="row-title">Leggo i file su questo dispositivo…</p>
              <p className="muted small">
                {p?.file}
                {p?.page ? ` · pagina ${p.page} di ${p.pages}` : ''}
              </p>
            </>
          )}
          {stage.name === 'asking' && (
            <>
              <p className="row-title">Il modello sta estraendo parole, grammatica e frasi…</p>
              <p className="muted small">Può volerci un minuto o due. Lascia aperta questa pagina.</p>
            </>
          )}
          {stage.name === 'saving' && <p className="row-title">Salvo la lezione…</p>}
          {stage.name === 'generating' && (
            <>
              <p className="row-title">Lezione salvata. Preparo esercizi aggiuntivi…</p>
              <p className="muted small">Una sola richiesta, solo testo. Puoi saltarla e farla più tardi.</p>
            </>
          )}
        </div>
        {(stage.name === 'reading' || stage.name === 'asking' || stage.name === 'generating') && (
          <button type="button" className="btn btn-block" onClick={() => controller.current?.abort()}>
            {stage.name === 'generating' ? 'Salta' : 'Annulla'}
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="page">
      <PageHead title="Nuova lezione">
        <a className="btn btn-quiet" href="#/lessons">
          Chiudi
        </a>
      </PageHead>

      {!keyPresent && (
        <div className="notice stack">
          <p>Per estrarre una lezione serve una chiave API gratuita di Gemini.</p>
          <a className="btn" href="#/settings">
            Inseriscila nelle impostazioni
          </a>
        </div>
      )}
      {error && (
        <p className="notice bad small" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        <span>I file di una lezione: slide (PDF), compiti (DOCX), foto o testo</span>
        <input
          className="file-input"
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp,application/pdf"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </label>

      {files.length > 0 && (
        <ul className="plain-list small">
          {files.map((f) => (
            <li key={f.name + f.size}>
              {f.name} <span className="muted">· {(f.size / 1048576).toFixed(1)} MB</span>
              {fileKind(f.name, f.type) === 'other' && <span className="tag bad">non supportato</span>}
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn btn-primary btn-block" disabled={files.length === 0 || !keyPresent} onClick={() => void extract()}>
        Estrai la lezione
      </button>

      <p className="muted small">
        I file vengono letti sul dispositivo e non sono conservati. Il testo e le immagini delle pagine vengono inviati a
        Gemini (Google) per l&apos;estrazione: non caricare documenti con dati personali. Servono 2 richieste per lezione.
      </p>
    </main>
  );
}

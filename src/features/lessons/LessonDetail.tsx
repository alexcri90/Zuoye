import { useState } from 'react';
import { Zh } from '../../components/ui.tsx';
import type { ItemStore } from '../../lib/db.ts';
import { generateExercises } from '../../lib/ingest/pipeline.ts';
import { count } from '../../lib/italian.ts';
import { currentProvider, hasApiKey } from '../../lib/llm/index.ts';
import { LlmError } from '../../lib/llm/provider.ts';
import { BLANK } from '../../lib/schema.ts';
import { navigate } from '../../router.ts';
import { useStore } from '../../store.ts';

const TABS = ['Parole', 'Grammatica', 'Frasi', 'Esercizi'] as const;
type Tab = (typeof TABS)[number];

const SOURCE_LABEL = { lezione: 'lezione', compiti: 'compiti', ai: 'generata' } as const;

/** One lesson: its words, grammar, sentences and stored exercises. */
export function LessonDetail({ id }: { id: string }) {
  const { data, db, prefs, refresh } = useStore();
  const [tab, setTab] = useState<Tab>('Parole');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const lesson = data.lessons.find((l) => l.id === id);
  if (!lesson) {
    return (
      <main className="page">
        <p className="notice">Questa lezione non c&apos;è più.</p>
        <a className="btn" href="#/lessons">
          Torna alle lezioni
        </a>
      </main>
    );
  }

  const mine = <T extends { lessonId: string }>(rows: readonly T[]) => rows.filter((r) => r.lessonId === id);
  const vocab = mine(data.vocab);
  const grammar = mine(data.grammar);
  const sentences = mine(data.sentences);
  const clozes = mine(data.clozes);
  const counts: Record<Tab, number> = { Parole: vocab.length, Grammatica: grammar.length, Frasi: sentences.length, Esercizi: clozes.length };

  const remove = async (store: ItemStore, itemId: string, label: string) => {
    if (!window.confirm(`Eliminare ${label}? Si perdono anche i suoi progressi.`)) return;
    await db.deleteItem(store, itemId);
    await refresh();
  };

  const removeLesson = async () => {
    if (!window.confirm(`Eliminare "${lesson.title}" con tutte le parole, le frasi e i progressi?`)) return;
    await db.deleteLesson(id);
    await refresh();
    navigate('/lessons', true);
  };

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const extra = await generateExercises(currentProvider(prefs), data, id);
      await db.addExercises(extra.sentences, extra.clozes);
      await refresh();
      setMessage(`Esercizi aggiunti: ${count(extra.sentences.length, 'frase', 'frasi')} e ${count(extra.clozes.length, 'completamento', 'completamenti')}.`);
    } catch (e) {
      setMessage(e instanceof LlmError ? e.message : 'Non sono riuscito a generare gli esercizi.');
    } finally {
      setBusy(false);
    }
  };

  const removeButton = (store: ItemStore, itemId: string, label: string) => (
    <button type="button" className="remove" aria-label={`Elimina ${label}`} onClick={() => void remove(store, itemId, label)}>
      ×
    </button>
  );

  return (
    <main className="page">
      <header className="stack">
        <a className="muted small" href="#/lessons">
          ‹ Lezioni
        </a>
        <h1 className="page-title">{lesson.number > 0 ? `${lesson.number}. ${lesson.title}` : lesson.title}</h1>
        {lesson.summary && <p className="muted small">{lesson.summary}</p>}
      </header>

      <div className="chips" role="tablist">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" className="chip" aria-selected={t === tab} aria-pressed={t === tab} onClick={() => setTab(t)}>
            {t} {counts[t]}
          </button>
        ))}
      </div>

      <div className="list" role="tabpanel">
        {tab === 'Parole' &&
          vocab.map((v) => (
            <div key={v.id} className="read-row">
              <Zh className="word">{v.hanzi}</Zh>
              <div className="row-main">
                <p className="pinyin">{v.pinyin}</p>
                <p className="small">
                  {v.meaning} {v.pos && <span className="muted">{v.pos}</span>}
                </p>
                {v.note && <p className="muted small">{v.note}</p>}
              </div>
              {removeButton('vocab', v.id, v.hanzi)}
            </div>
          ))}

        {tab === 'Grammatica' &&
          grammar.map((g) => (
            <div key={g.id} className="read-row">
              <div className="row-main stack">
                <p className="row-title">{g.title}</p>
                {g.pattern && (
                  <p>
                    <Zh>{g.pattern}</Zh>
                  </p>
                )}
                <p className="small">{g.explanation}</p>
                {g.examples.map((e, i) => (
                  <p key={i} className="small">
                    <Zh>{e.zh}</Zh>
                    <br />
                    <span className="muted">
                      {e.pinyin} · {e.it}
                    </span>
                  </p>
                ))}
              </div>
              {removeButton('grammar', g.id, 'questo punto di grammatica')}
            </div>
          ))}

        {tab === 'Frasi' &&
          sentences.map((s) => (
            <div key={s.id} className="read-row">
              <div className="row-main">
                <p className="zh-line">
                  <Zh>{s.zh}</Zh>
                </p>
                <p className="muted small">{s.pinyin}</p>
                <p className="small">
                  {s.it} <span className="tag">{SOURCE_LABEL[s.source]}</span>
                </p>
              </div>
              {removeButton('sentences', s.id, 'questa frase')}
            </div>
          ))}

        {tab === 'Esercizi' &&
          clozes.map((c) => (
            <div key={c.id} className="read-row">
              <div className="row-main">
                <p className="zh-line">
                  <Zh>{c.text.replace(BLANK, ' ＿＿ ')}</Zh>
                </p>
                <p className="small">
                  <Zh>{c.answer}</Zh> <span className="muted">tra</span> <Zh>{c.options.join(' · ')}</Zh>{' '}
                  <span className="tag">{SOURCE_LABEL[c.source]}</span>
                </p>
                {c.explanation && <p className="muted small">{c.explanation}</p>}
              </div>
              {removeButton('clozes', c.id, 'questo esercizio')}
            </div>
          ))}

        {counts[tab] === 0 && <p className="muted small empty">Niente qui.</p>}
      </div>

      {message && (
        <p className="notice small" role="status">
          {message}
        </p>
      )}

      <div className="stack">
        <button type="button" className="btn btn-block" disabled={busy || !hasApiKey()} onClick={() => void generate()}>
          {busy ? 'Genero…' : 'Genera altri esercizi'}
        </button>
        <button type="button" className="btn btn-block btn-danger" onClick={() => void removeLesson()}>
          Elimina la lezione
        </button>
      </div>
    </main>
  );
}

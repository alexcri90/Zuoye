import { useMemo, useState } from 'react';
import { Seal, Zh } from '../../components/ui.tsx';
import { counts } from '../../lib/practice.ts';
import { navigate } from '../../router.ts';
import { useStore } from '../../store.ts';
import { ENABLED_SKILLS, SKILL_INFO } from '../practice/skills.ts';

export function Home() {
  const { data, prefs, setPrefs } = useStore();
  const [now] = useState(() => Date.now());
  const selected = prefs.lessons.filter((id) => data.lessons.some((l) => l.id === id));
  const perSkill = useMemo(() => counts(data, selected, now), [data, selected, now]);

  const due = ENABLED_SKILLS.reduce((n, s) => n + perSkill[s].due, 0);
  const fresh = ENABLED_SKILLS.reduce((n, s) => n + perSkill[s].fresh, 0);
  const total = ENABLED_SKILLS.reduce((n, s) => n + perSkill[s].total, 0);

  const toggle = (id: string) =>
    setPrefs({ lessons: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });

  return (
    <main className="page">
      <header className="page-head">
        <Seal />
        <div>
          <h1 className="page-title">Zuòyè</h1>
          <p className="muted small">
            {data.lessons.length === 0
              ? 'Esercizi di cinese dalle tue lezioni'
              : due > 0
                ? `${due} da ripassare oggi`
                : fresh > 0
                  ? `${fresh} esercizi nuovi`
                  : 'Niente da ripassare oggi'}
          </p>
        </div>
      </header>

      {data.lessons.length === 0 ? (
        <div className="notice stack">
          <p>Non ci sono ancora lezioni. Aggiungine una per cominciare.</p>
          <a className="btn btn-primary" href="#/lessons">
            Vai alle lezioni
          </a>
        </div>
      ) : (
        <>
          <section className="stack" aria-label="Lezioni da esercitare">
            <h2 className="section-title">Lezioni</h2>
            <div className="chips">
              <button type="button" className="chip" aria-pressed={selected.length === 0} onClick={() => setPrefs({ lessons: [] })}>
                Tutte
              </button>
              {data.lessons.map((lesson) => (
                <button
                  key={lesson.id}
                  type="button"
                  className="chip"
                  aria-pressed={selected.includes(lesson.id)}
                  onClick={() => toggle(lesson.id)}
                  title={lesson.title}
                >
                  {lesson.number > 0 ? `Lezione ${lesson.number}` : lesson.title}
                </button>
              ))}
            </div>
          </section>

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={total === 0}
            onClick={() => navigate(due + fresh > 0 ? '/practice/mista' : '/practice/mista?extra=1')}
          >
            {due + fresh > 0 ? 'Sessione mista' : 'Ripasso libero'}
          </button>

          <section className="stack" aria-label="Tipi di esercizio">
            <h2 className="section-title">Esercizi</h2>
            <div className="list">
              {ENABLED_SKILLS.map((skill) => {
                const info = SKILL_INFO[skill];
                const c = perSkill[skill];
                const todo = c.due + c.fresh;
                return (
                  <button
                    key={skill}
                    type="button"
                    className="row"
                    disabled={c.total === 0}
                    onClick={() => navigate(todo > 0 ? `/practice/${skill}` : `/practice/${skill}?extra=1`)}
                  >
                    <Zh className="row-icon">{info.icon}</Zh>
                    <span className="row-main">
                      <span className="row-title">{info.title}</span>
                      <br />
                      <span className="muted small">{info.hint}</span>
                    </span>
                    <span className="row-count">
                      <strong>{c.due}</strong>
                      {c.fresh > 0 ? `+${c.fresh} nuovi` : 'da ripassare'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

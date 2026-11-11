import { PageHead } from '../../components/ui.tsx';
import { useStore } from '../../store.ts';

const SESSION_SIZES = [5, 10, 15, 20, 30];

export function Settings() {
  const { data, prefs, setPrefs } = useStore();

  return (
    <main className="page">
      <PageHead title="Impostazioni" />

      <section className="stack">
        <h2 className="section-title">Sessione</h2>
        <p className="muted small">Quanti esercizi in una sessione.</p>
        <div className="chips">
          {SESSION_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              className="chip"
              aria-pressed={prefs.sessionSize === size}
              onClick={() => setPrefs({ sessionSize: size })}
            >
              {size}
            </button>
          ))}
        </div>
      </section>

      <hr className="rule" />

      <section className="stack">
        <h2 className="section-title">Dati su questo dispositivo</h2>
        <p className="small">
          {data.lessons.length} lezioni · {data.vocab.length} parole · {data.sentences.length} frasi · {data.cards.length}{' '}
          schede di ripasso
        </p>
        <p className="muted small">Lezioni e progressi restano in questo browser: non vengono inviati a nessun server.</p>
      </section>
    </main>
  );
}

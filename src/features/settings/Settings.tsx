import { useState } from 'react';
import { PageHead } from '../../components/ui.tsx';
import { resumeModel } from '../../lib/grading.ts';
import { currentProvider } from '../../lib/llm/index.ts';
import { LlmError } from '../../lib/llm/provider.ts';
import {
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_MODEL,
  clearApiKey,
  getApiKey,
  maskKey,
  requestsToday,
  setApiKey,
} from '../../lib/settings.ts';
import { useStore } from '../../store.ts';

const SESSION_SIZES = [5, 10, 15, 20, 30];
/** Free-tier text models on 2026-11-11; "Verifica chiave" replaces this with what the key can really use. */
const KNOWN_MODELS = [DEFAULT_MODEL, 'gemini-3.6-flash', DEFAULT_FALLBACK_MODEL, 'gemini-3.1-flash-lite'];

type Check = { state: 'idle' | 'busy' } | { state: 'ok'; models: string[] } | { state: 'error'; message: string };

export function Settings() {
  const { data, prefs, setPrefs } = useStore();
  const [stored, setStored] = useState(() => getApiKey());
  const [typed, setTyped] = useState('');
  const [keyError, setKeyError] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [used] = useState(() => requestsToday(Date.now()));

  const models = [...new Set([...(check.state === 'ok' ? check.models : KNOWN_MODELS), prefs.model, prefs.fallbackModel])];

  const saveKey = () => {
    const ok = setApiKey(typed);
    setKeyError(!ok);
    if (!ok) return;
    setStored(getApiKey());
    setTyped('');
    setCheck({ state: 'idle' });
    resumeModel(); // a new key deserves a new try
  };

  const verify = async () => {
    setCheck({ state: 'busy' });
    try {
      setCheck({ state: 'ok', models: await currentProvider(prefs).listModels() });
    } catch (e) {
      setCheck({ state: 'error', message: e instanceof LlmError ? e.message : 'Verifica non riuscita.' });
    }
  };

  return (
    <main className="page">
      <PageHead title="Impostazioni" />

      <section className="stack">
        <h2 className="section-title">Chiave API di Gemini</h2>
        <p className="muted small">
          Serve per estrarre le lezioni e correggere le traduzioni. Creala gratis in Google AI Studio, in un progetto senza
          fatturazione: così non può essere addebitato nulla. Resta in questo browser e viene inviata solo a Google.
        </p>
        {stored ? (
          <>
            <p>
              Chiave salvata: <span className="mono">{maskKey(stored)}</span>
            </p>
            <div className="btn-row">
              <button type="button" className="btn" disabled={check.state === 'busy'} onClick={() => void verify()}>
                {check.state === 'busy' ? 'Verifico…' : 'Verifica chiave'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  clearApiKey();
                  setStored('');
                  setCheck({ state: 'idle' });
                }}
              >
                Elimina chiave
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span>Incolla la chiave</span>
              <input
                className="input mono"
                type="password"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setKeyError(false);
                }}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={keyError}
              />
            </label>
            {keyError && (
              <p className="notice bad small" role="alert">
                Non sembra una chiave: controlla di averla copiata intera, senza spazi.
              </p>
            )}
            <button type="button" className="btn btn-primary" disabled={typed.trim() === ''} onClick={saveKey}>
              Salva chiave
            </button>
          </>
        )}
        {check.state === 'ok' && (
          <p className="notice small" role="status">
            Chiave valida: {check.models.length} modelli disponibili.
            {!check.models.includes(prefs.model) && ' Il modello scelto non è tra questi: cambialo qui sotto.'}
          </p>
        )}
        {check.state === 'error' && (
          <p className="notice bad small" role="alert">
            {check.message}
          </p>
        )}
      </section>

      <section className="stack">
        <h2 className="section-title">Modello</h2>
        <label className="field">
          <span>Principale</span>
          <select className="input" value={prefs.model} onChange={(e) => setPrefs({ model: e.target.value })}>
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Di riserva, se la quota del principale è finita</span>
          <select className="input" value={prefs.fallbackModel} onChange={(e) => setPrefs({ fallbackModel: e.target.value })}>
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <p className="muted small">Richieste inviate oggi da questo dispositivo: {used}.</p>
      </section>

      <hr className="rule" />

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

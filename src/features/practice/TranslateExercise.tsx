import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Zh } from '../../components/ui.tsx';
import { gradeTranslation, rateVerdict, sides, withAccepted, type Direction, type Outcome } from '../../lib/grading.ts';
import { currentProvider } from '../../lib/llm/index.ts';
import type { Sentence } from '../../lib/schema.ts';
import type { Rating } from '../../lib/srs.ts';
import { useStore } from '../../store.ts';

type Phase = { name: 'answer' } | { name: 'checking' } | { name: 'result'; outcome: Outcome | { kind: 'skipped' } };

const VERDICT_TITLE = { corretta: 'Corretta', quasi: 'Quasi giusta', errata: 'Da rivedere' } as const;
const VERDICT_STYLE = { corretta: 'feedback ok', quasi: 'feedback warn', errata: 'feedback bad' } as const;

/** Exercises 3 and 4: translate a sentence; the model corrects it, or the student compares with the solution. */
export function TranslateExercise({ sentence, direction, onDone }: { sentence: Sentence; direction: Direction; onDone: (rating: Rating) => void }) {
  const { prefs, saveSentence } = useStore();
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'answer' });
  const controller = useRef<AbortController | null>(null);
  const toChinese = direction === 'it-zh';
  const { source, reference } = sides(direction, sentence);

  useEffect(() => () => controller.current?.abort(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phase.name !== 'answer' || value.trim() === '') return;
    const run = new AbortController();
    controller.current = run;
    setPhase({ name: 'checking' });
    const provider = navigator.onLine ? currentProvider(prefs) : null;
    const outcome = await gradeTranslation(provider, direction, sentence, value, run.signal);
    if (run.signal.aborted) return;
    if (outcome.kind === 'verdict' && outcome.verdict.verdict === 'corretta') {
      // Remember it: the same answer will not cost another request.
      const updated = withAccepted(direction, sentence, value);
      if (updated) void saveSentence(updated);
    }
    setPhase({ name: 'result', outcome });
  };

  const solution = (
    <p className="small">
      <span className="muted">Soluzione: </span>
      {toChinese ? (
        <>
          <Zh className="zh-inline">{reference}</Zh>
          <br />
          <span className="pinyin-small" lang="zh-Latn">
            {sentence.pinyin}
          </span>
        </>
      ) : (
        reference
      )}
    </p>
  );
  const yours = (
    <p className="small muted">
      La tua risposta: {toChinese ? <Zh className="zh-inline">{value}</Zh> : value}
    </p>
  );

  const outcome = phase.name === 'result' ? phase.outcome : null;

  return (
    <form className="exercise" onSubmit={(e) => void submit(e)} noValidate>
      <div className="prompt">
        <span className="prompt-label">{toChinese ? 'Traduci in cinese' : 'Traduci in italiano'}</span>
        {toChinese ? <span className="prompt-meaning">{source}</span> : <Zh className="zh-sentence">{source}</Zh>}
        {!toChinese && outcome && (
          <span className="pinyin-small" lang="zh-Latn">
            {sentence.pinyin}
          </span>
        )}
      </div>

      {outcome?.kind === 'exact' && (
        <div className="feedback ok" role="status">
          <span className="feedback-title">Giusto</span>
          {solution}
        </div>
      )}

      {outcome?.kind === 'verdict' && (
        <div className={VERDICT_STYLE[outcome.verdict.verdict]} role="status">
          <span className="feedback-title">
            {VERDICT_TITLE[outcome.verdict.verdict]} <span className="score">{outcome.verdict.score}/100</span>
          </span>
          {outcome.verdict.comment && <p>{outcome.verdict.comment}</p>}
          {outcome.verdict.verdict !== 'corretta' && outcome.verdict.corrected && (
            <p className="small">
              <span className="muted">Corretta: </span>
              {toChinese ? <Zh className="zh-inline">{outcome.verdict.corrected}</Zh> : outcome.verdict.corrected}
              {outcome.verdict.correctedPinyin && (
                <>
                  <br />
                  <span className="pinyin-small" lang="zh-Latn">
                    {outcome.verdict.correctedPinyin}
                  </span>
                </>
              )}
            </p>
          )}
          {outcome.verdict.errors.length > 0 && (
            <ul className="errors small">
              {outcome.verdict.errors.map((e, i) => (
                <li key={i}>
                  <span className="tag">{e.type}</span> {e.detail}
                </li>
              ))}
            </ul>
          )}
          {yours}
          {solution}
        </div>
      )}

      {outcome?.kind === 'skipped' && (
        <div className="feedback bad" role="status">
          <span className="feedback-title">Ecco la soluzione</span>
          {solution}
        </div>
      )}

      {outcome?.kind === 'self' && (
        <div className="feedback warn" role="status">
          <span className="feedback-title">Confronta con la soluzione</span>
          <p className="small muted">{outcome.reason}</p>
          {yours}
          {solution}
        </div>
      )}

      {phase.name !== 'result' && (
        <textarea
          className="input area"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={phase.name === 'checking'}
          aria-label={toChinese ? 'Traduzione in cinese' : 'Traduzione in italiano'}
          placeholder={toChinese ? '用汉字写' : 'Scrivi in italiano'}
          lang={toChinese ? 'zh-Hans' : 'it'}
          maxLength={300}
          autoCapitalize={toChinese ? 'none' : 'sentences'}
          autoComplete="off"
          autoFocus
        />
      )}

      {outcome?.kind === 'self' ? (
        <div className="btn-row" role="group" aria-label="Com'era la tua risposta?">
          <button type="button" className="btn" onClick={() => onDone('again')}>
            Sbagliata
          </button>
          <button type="button" className="btn" onClick={() => onDone('hard')}>
            Quasi
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onDone('good')}>
            Giusta
          </button>
        </div>
      ) : outcome ? (
        <button
          type="button"
          className="btn btn-primary btn-block"
          autoFocus
          onClick={() => onDone(outcome.kind === 'exact' ? 'good' : outcome.kind === 'verdict' ? rateVerdict(outcome.verdict) : 'again')}
        >
          Avanti
        </button>
      ) : (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={phase.name === 'checking'}
            onClick={() => setPhase({ name: 'result', outcome: { kind: 'skipped' } })}
          >
            Non lo so
          </button>
          <button type="submit" className="btn btn-primary" disabled={phase.name === 'checking' || value.trim() === ''}>
            {phase.name === 'checking' ? 'Correggo…' : 'Verifica'}
          </button>
        </div>
      )}
    </form>
  );
}
